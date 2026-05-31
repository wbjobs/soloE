#![allow(non_snake_case)]

use napi_derive::napi;
use osmpbf::{Element, ElementReader};
use priority_queue::PriorityQueue;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::f64::consts::PI;
use std::sync::Mutex;

const EARTH_RADIUS: f64 = 6371000.0;
const GRID_CELL_SIZE_METERS: f64 = 200.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Coordinate {
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: i64,
    pub coord: Coordinate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub from: i64,
    pub to: i64,
    pub distance: f64,
    pub highway: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CongestionZone {
    pub id: String,
    pub center: Coordinate,
    pub radius: f64,
    pub multiplier: f64,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnergyConsumption {
    pub totalFuelLiters: f64,
    pub totalElectricKwh: f64,
    pub cost: f64,
    pub fuelRateLPer100Km: f64,
    pub electricRateKwhPer100Km: f64,
    pub idleTimeSeconds: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteResult {
    pub success: bool,
    pub distance: f64,
    pub duration: f64,
    pub path: Vec<Coordinate>,
    pub nodes: Vec<i64>,
    pub algorithm: String,
    pub message: Option<String>,
    pub energy: Option<EnergyConsumption>,
    pub congestionAvoided: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapResult {
    pub success: bool,
    pub original: Coordinate,
    pub snapped: Coordinate,
    pub edge: Option<Edge>,
    pub distance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TripStep {
    pub coord: Coordinate,
    pub edge_index: usize,
    pub progress: f64,
    pub timestamp: f64,
    pub speed: f64,
    pub fuelUsed: f64,
    pub electricUsed: f64,
    pub inCongestion: bool,
    pub congestionMultiplier: f64,
    pub currentFuelRate: f64,
    pub currentElectricRate: f64,
}

type GridKey = (i32, i32);

pub struct RoutingGraph {
    nodes: HashMap<i64, Node>,
    adjacency: HashMap<i64, Vec<Edge>>,
    edges: Vec<Edge>,
    node_ids: Vec<i64>,
    grid: HashMap<GridKey, Vec<i64>>,
    congestion_zones: Vec<CongestionZone>,
    min_lat: f64,
    max_lat: f64,
    min_lon: f64,
    max_lon: f64,
    lat_per_cell: f64,
    lon_per_cell: f64,
    loaded: bool,
}

impl RoutingGraph {
    fn new() -> Self {
        RoutingGraph {
            nodes: HashMap::new(),
            adjacency: HashMap::new(),
            edges: Vec::new(),
            node_ids: Vec::new(),
            grid: HashMap::new(),
            congestion_zones: Vec::new(),
            min_lat: f64::INFINITY,
            max_lat: f64::NEG_INFINITY,
            min_lon: f64::INFINITY,
            max_lon: f64::NEG_INFINITY,
            lat_per_cell: 0.0,
            lon_per_cell: 0.0,
            loaded: false,
        }
    }

    fn haversine_distance(a: &Coordinate, b: &Coordinate) -> f64 {
        let phi1 = a.lat * PI / 180.0;
        let phi2 = b.lat * PI / 180.0;
        let delta_phi = (b.lat - a.lat) * PI / 180.0;
        let delta_lambda = (b.lon - a.lon) * PI / 180.0;
        let h = (delta_phi / 2.0).sin().powi(2)
            + phi1.cos() * phi2.cos() * (delta_lambda / 2.0).sin().powi(2);
        2.0 * EARTH_RADIUS * h.sqrt().asin()
    }

    fn point_to_line_distance(
        p: &Coordinate,
        a: &Coordinate,
        b: &Coordinate,
    ) -> (f64, Coordinate, f64) {
        let lat_diff = b.lat - a.lat;
        let lon_diff = b.lon - a.lon;
        let len_sq = lat_diff * lat_diff + lon_diff * lon_diff;

        if len_sq == 0.0 {
            let d = Self::haversine_distance(p, a);
            return (d, a.clone(), 0.0);
        }

        let t = ((p.lat - a.lat) * lat_diff + (p.lon - a.lon) * lon_diff) / len_sq;
        let t = t.clamp(0.0, 1.0);

        let proj = Coordinate {
            lat: a.lat + t * lat_diff,
            lon: a.lon + t * lon_diff,
        };

        let d = Self::haversine_distance(p, &proj);
        (d, proj, t)
    }

    fn coord_to_grid(&self, coord: &Coordinate) -> GridKey {
        let lat_idx = ((coord.lat - self.min_lat) / self.lat_per_cell).floor() as i32;
        let lon_idx = ((coord.lon - self.min_lon) / self.lon_per_cell).floor() as i32;
        (lat_idx, lon_idx)
    }

    fn build_spatial_index(&mut self) {
        if self.nodes.is_empty() {
            return;
        }

        for node in self.nodes.values() {
            self.min_lat = self.min_lat.min(node.coord.lat);
            self.max_lat = self.max_lat.max(node.coord.lat);
            self.min_lon = self.min_lon.min(node.coord.lon);
            self.max_lon = self.max_lon.max(node.coord.lon);
        }

        let center_lat = (self.min_lat + self.max_lat) / 2.0;
        let lat_circumference = 2.0 * PI * EARTH_RADIUS * (center_lat * PI / 180.0).cos();
        self.lat_per_cell = (GRID_CELL_SIZE_METERS / EARTH_RADIUS) * (180.0 / PI);
        self.lon_per_cell = (GRID_CELL_SIZE_METERS / lat_circumference) * 360.0;

        for (id, node) in &self.nodes {
            let key = self.coord_to_grid(&node.coord);
            self.grid.entry(key).or_insert_with(Vec::new).push(*id);
        }
    }

    fn get_nearby_cells(&self, coord: &Coordinate, radius_cells: i32) -> Vec<GridKey> {
        let (center_lat, center_lon) = self.coord_to_grid(coord);
        let mut cells = Vec::new();
        for lat_off in -radius_cells..=radius_cells {
            for lon_off in -radius_cells..=radius_cells {
                cells.push((center_lat + lat_off, center_lon + lon_off));
            }
        }
        cells
    }

    fn find_nearest_node_fast(&self, coord: &Coordinate) -> Option<i64> {
        if self.grid.is_empty() {
            return self.find_nearest_node_bruteforce(coord);
        }

        let mut nearest_id = None;
        let mut min_dist = f64::INFINITY;
        let mut radius = 1;

        while radius <= 5 {
            let cells = self.get_nearby_cells(coord, radius);
            let mut found = false;

            for cell in cells {
                if let Some(node_ids) = self.grid.get(&cell) {
                    for &id in node_ids {
                        if let Some(node) = self.nodes.get(&id) {
                            let d = Self::haversine_distance(coord, &node.coord);
                            if d < min_dist {
                                min_dist = d;
                                nearest_id = Some(id);
                                found = true;
                            }
                        }
                    }
                }
            }

            if found && min_dist < GRID_CELL_SIZE_METERS * radius as f64 {
                break;
            }
            radius += 1;
        }

        if nearest_id.is_none() {
            self.find_nearest_node_bruteforce(coord)
        } else {
            nearest_id
        }
    }

    fn find_nearest_node_bruteforce(&self, coord: &Coordinate) -> Option<i64> {
        let mut nearest_id = None;
        let mut min_dist = f64::INFINITY;

        for (id, node) in &self.nodes {
            let d = Self::haversine_distance(coord, &node.coord);
            if d < min_dist {
                min_dist = d;
                nearest_id = Some(*id);
            }
        }

        nearest_id
    }

    fn find_nearest_edge_fast(&self, coord: &Coordinate) -> Option<(f64, Coordinate, Edge, f64)> {
        let mut best = None;
        let mut best_dist = f64::INFINITY;
        let nearby_nodes = self.get_nearby_nodes(coord, 3);

        for &node_id in &nearby_nodes {
            if let Some(edges) = self.adjacency.get(&node_id) {
                for edge in edges {
                    if let (Some(from), Some(to)) =
                        (self.nodes.get(&edge.from), self.nodes.get(&edge.to))
                    {
                        let (d, proj, t) =
                            Self::point_to_line_distance(coord, &from.coord, &to.coord);
                        if d < best_dist {
                            best_dist = d;
                            best = Some((d, proj, edge.clone(), t));
                        }
                    }
                }
            }
        }

        if best.is_none() || best_dist > 500.0 {
            for edge in &self.edges {
                if let (Some(from), Some(to)) =
                    (self.nodes.get(&edge.from), self.nodes.get(&edge.to))
                {
                    let (d, proj, t) =
                        Self::point_to_line_distance(coord, &from.coord, &to.coord);
                    if d < best_dist {
                        best_dist = d;
                        best = Some((d, proj, edge.clone(), t));
                    }
                }
            }
        }

        best
    }

    fn get_nearby_nodes(&self, coord: &Coordinate, radius_cells: i32) -> Vec<i64> {
        let mut result = Vec::new();
        if self.grid.is_empty() {
            return self.node_ids.clone();
        }

        let cells = self.get_nearby_cells(coord, radius_cells);
        for cell in cells {
            if let Some(ids) = self.grid.get(&cell) {
                result.extend(ids);
            }
        }

        if result.is_empty() {
            return self.node_ids.clone();
        }

        result
    }

    fn get_congestion_multiplier(&self, coord: &Coordinate) -> (f64, bool) {
        let mut max_multiplier = 1.0;
        let mut in_congestion = false;

        for zone in &self.congestion_zones {
            let d = Self::haversine_distance(coord, &zone.center);
            if d <= zone.radius {
                let falloff = 1.0 - (d / zone.radius).min(1.0);
                let effective_multiplier = 1.0 + (zone.multiplier - 1.0) * falloff;
                if effective_multiplier > max_multiplier {
                    max_multiplier = effective_multiplier;
                    in_congestion = true;
                }
            }
        }

        (max_multiplier, in_congestion)
    }

    fn get_edge_cost(&self, edge: &Edge) -> f64 {
        if let (Some(from), Some(to)) = (self.nodes.get(&edge.from), self.nodes.get(&edge.to)) {
            let mid_coord = Coordinate {
                lat: (from.coord.lat + to.coord.lat) / 2.0,
                lon: (from.coord.lon + to.coord.lon) / 2.0,
            };
            let (multiplier, _) = self.get_congestion_multiplier(&mid_coord);
            return edge.distance * multiplier;
        }
        edge.distance
    }

    fn add_congestion_zone(&mut self, zone: CongestionZone) {
        self.congestion_zones.push(zone);
    }

    fn remove_congestion_zone(&mut self, zone_id: &str) -> bool {
        let initial_len = self.congestion_zones.len();
        self.congestion_zones.retain(|z| z.id != zone_id);
        self.congestion_zones.len() < initial_len
    }

    fn clear_congestion_zones(&mut self) {
        self.congestion_zones.clear();
    }

    fn get_congestion_zones(&self) -> Vec<CongestionZone> {
        self.congestion_zones.clone()
    }

    fn calculate_energy_consumption(
        &self,
        distance_m: f64,
        avg_speed_kmh: f64,
        congestion_multiplier: f64,
    ) -> EnergyConsumption {
        let distance_km = distance_m / 1000.0;

        let base_fuel_rate = 8.0;
        let base_electric_rate = 15.0;

        let speed_factor = if avg_speed_kmh < 20.0 {
            1.8
        } else if avg_speed_kmh < 50.0 {
            1.2
        } else if avg_speed_kmh < 90.0 {
            1.0
        } else if avg_speed_kmh < 120.0 {
            1.15
        } else {
            1.4
        };

        let congestion_factor = congestion_multiplier.max(1.0);
        let effective_fuel_rate = base_fuel_rate * speed_factor * congestion_factor;
        let effective_electric_rate = base_electric_rate * speed_factor * congestion_factor.powf(0.5);

        let total_fuel = (distance_km / 100.0) * effective_fuel_rate;
        let total_electric = (distance_km / 100.0) * effective_electric_rate;

        let fuel_price = 7.5;
        let electricity_price = 0.8;
        let cost = total_fuel * fuel_price + total_electric * electricity_price * 0.5;

        let idle_time = if congestion_multiplier > 2.0 {
            distance_m / (5.0 / 3.6) * (congestion_multiplier - 1.0)
        } else {
            0.0
        };

        EnergyConsumption {
            totalFuelLiters: total_fuel,
            totalElectricKwh: total_electric,
            cost,
            fuelRateLPer100Km: effective_fuel_rate,
            electricRateKwhPer100Km: effective_electric_rate,
            idleTimeSeconds: idle_time,
        }
    }

    fn load_pbf(&mut self, path: &str) -> Result<(), String> {
        let reader = ElementReader::from_path(path).map_err(|e| e.to_string())?;
        let mut highway_ways: Vec<(i64, Vec<i64>, String)> = Vec::new();

        reader
            .for_each(|element| match element {
                Element::Node(node) => {
                    let id = node.id();
                    let coord = Coordinate {
                        lat: node.lat(),
                        lon: node.lon(),
                    };
                    self.nodes.insert(id, Node { id, coord });
                }
                Element::Way(way) => {
                    if let Some(highway) = way.tags().find(|(k, _)| *k == "highway") {
                        let highway_type = highway.1.to_string();
                        let ids: Vec<i64> = way.refs().collect();
                        highway_ways.push((way.id(), ids, highway_type));
                    }
                }
                _ => {}
            })
            .map_err(|e| e.to_string())?;

        let allowed_highways: HashSet<&str> = [
            "motorway",
            "trunk",
            "primary",
            "secondary",
            "tertiary",
            "unclassified",
            "residential",
            "service",
            "motorway_link",
            "trunk_link",
            "primary_link",
            "secondary_link",
            "tertiary_link",
            "living_street",
            "road",
        ]
        .iter()
        .cloned()
        .collect();

        for (_, node_refs, highway_type) in highway_ways {
            if !allowed_highways.contains(highway_type.as_str()) {
                continue;
            }

            for window in node_refs.windows(2) {
                let from_id = window[0];
                let to_id = window[1];

                if let (Some(from_node), Some(to_node)) =
                    (self.nodes.get(&from_id), self.nodes.get(&to_id))
                {
                    let distance =
                        Self::haversine_distance(&from_node.coord, &to_node.coord);

                    let edge = Edge {
                        from: from_id,
                        to: to_id,
                        distance,
                        highway: highway_type.clone(),
                    };

                    self.adjacency
                        .entry(from_id)
                        .or_insert_with(Vec::new)
                        .push(edge.clone());

                    self.adjacency
                        .entry(to_id)
                        .or_insert_with(Vec::new)
                        .push(Edge {
                            from: to_id,
                            to: from_id,
                            distance,
                            highway: highway_type.clone(),
                        });

                    self.edges.push(edge);
                }
            }
        }

        self.node_ids = self.nodes.keys().cloned().collect();
        self.build_spatial_index();
        self.loaded = true;
        Ok(())
    }

    fn dijkstra(&self, start: i64, end: i64) -> Option<(Vec<i64>, f64, f64)> {
        let mut dist: HashMap<i64, f64> = HashMap::new();
        let mut actual_dist: HashMap<i64, f64> = HashMap::new();
        let mut prev: HashMap<i64, i64> = HashMap::new();
        let mut pq = PriorityQueue::new();

        dist.insert(start, 0.0);
        actual_dist.insert(start, 0.0);
        pq.push(start, std::cmp::Reverse(0.0));

        while let Some((current, priority)) = pq.pop() {
            let current_cost = priority.0;
            if current == end {
                break;
            }
            if current_cost > *dist.get(&current).unwrap_or(&f64::INFINITY) {
                continue;
            }

            if let Some(neighbors) = self.adjacency.get(&current) {
                for edge in neighbors {
                    let edge_cost = self.get_edge_cost(edge);
                    let new_cost = current_cost + edge_cost;
                    if new_cost < *dist.get(&edge.to).unwrap_or(&f64::INFINITY) {
                        dist.insert(edge.to, new_cost);
                        actual_dist.insert(
                            edge.to,
                            actual_dist.get(&current).unwrap_or(&0.0) + edge.distance,
                        );
                        prev.insert(edge.to, current);
                        pq.push(edge.to, std::cmp::Reverse(new_cost));
                    }
                }
            }
        }

        if *dist.get(&end).unwrap_or(&f64::INFINITY) == f64::INFINITY {
            return None;
        }

        let mut path = Vec::new();
        let mut current = end;
        while current != start {
            path.push(current);
            current = *prev.get(&current)?;
        }
        path.push(start);
        path.reverse();

        Some((
            path,
            *actual_dist.get(&end).unwrap(),
            *dist.get(&end).unwrap(),
        ))
    }

    fn bidirectional_a_star(&self, start: i64, end: i64) -> Option<(Vec<i64>, f64, f64)> {
        if start == end {
            return Some((vec![start], 0.0, 0.0));
        }

        let start_coord = self.nodes.get(&start)?.coord.clone();
        let end_coord = self.nodes.get(&end)?.coord.clone();

        let h_forward = |node_id: i64| -> f64 {
            if let Some(node) = self.nodes.get(&node_id) {
                Self::haversine_distance(&node.coord, &end_coord)
            } else {
                0.0
            }
        };

        let h_backward = |node_id: i64| -> f64 {
            if let Some(node) = self.nodes.get(&node_id) {
                Self::haversine_distance(&node.coord, &start_coord)
            } else {
                0.0
            }
        };

        let mut g_forward: HashMap<i64, f64> = HashMap::new();
        let mut g_backward: HashMap<i64, f64> = HashMap::new();
        let mut actual_g_forward: HashMap<i64, f64> = HashMap::new();
        let mut actual_g_backward: HashMap<i64, f64> = HashMap::new();
        let mut prev_forward: HashMap<i64, i64> = HashMap::new();
        let mut prev_backward: HashMap<i64, i64> = HashMap::new();
        let mut pq_forward = PriorityQueue::new();
        let mut pq_backward = PriorityQueue::new();
        let mut visited_forward: HashSet<i64> = HashSet::new();
        let mut visited_backward: HashSet<i64> = HashSet::new();

        g_forward.insert(start, 0.0);
        g_backward.insert(end, 0.0);
        actual_g_forward.insert(start, 0.0);
        actual_g_backward.insert(end, 0.0);
        pq_forward.push(start, std::cmp::Reverse(h_forward(start)));
        pq_backward.push(end, std::cmp::Reverse(h_backward(end)));

        let mut best_cost = f64::INFINITY;
        let mut best_actual_dist = f64::INFINITY;
        let mut meeting_node = None;

        while !pq_forward.is_empty() && !pq_backward.is_empty() {
            let forward_top = pq_forward.peek().map(|(_, p)| p.0).unwrap_or(f64::INFINITY);
            let backward_top = pq_backward.peek().map(|(_, p)| p.0).unwrap_or(f64::INFINITY);

            if forward_top + backward_top >= best_cost {
                break;
            }

            if forward_top <= backward_top {
                if let Some((current, _)) = pq_forward.pop() {
                    if visited_forward.contains(&current) {
                        continue;
                    }
                    visited_forward.insert(current);

                    if visited_backward.contains(&current) {
                        let total_cost = g_forward.get(&current).unwrap_or(&f64::INFINITY)
                            + g_backward.get(&current).unwrap_or(&f64::INFINITY);
                        let total_actual = actual_g_forward.get(&current).unwrap_or(&f64::INFINITY)
                            + actual_g_backward.get(&current).unwrap_or(&f64::INFINITY);
                        if total_cost < best_cost {
                            best_cost = total_cost;
                            best_actual_dist = total_actual;
                            meeting_node = Some(current);
                        }
                    }

                    let current_g = *g_forward.get(&current).unwrap_or(&f64::INFINITY);
                    let current_actual = *actual_g_forward.get(&current).unwrap_or(&0.0);

                    if let Some(neighbors) = self.adjacency.get(&current) {
                        for edge in neighbors {
                            if visited_forward.contains(&edge.to) {
                                continue;
                            }
                            let edge_cost = self.get_edge_cost(edge);
                            let tentative_g = current_g + edge_cost;
                            if tentative_g < *g_forward.get(&edge.to).unwrap_or(&f64::INFINITY) {
                                prev_forward.insert(edge.to, current);
                                g_forward.insert(edge.to, tentative_g);
                                actual_g_forward.insert(edge.to, current_actual + edge.distance);
                                let f = tentative_g + h_forward(edge.to);
                                pq_forward.push(edge.to, std::cmp::Reverse(f));
                            }
                        }
                    }
                }
            } else {
                if let Some((current, _)) = pq_backward.pop() {
                    if visited_backward.contains(&current) {
                        continue;
                    }
                    visited_backward.insert(current);

                    if visited_forward.contains(&current) {
                        let total_cost = g_forward.get(&current).unwrap_or(&f64::INFINITY)
                            + g_backward.get(&current).unwrap_or(&f64::INFINITY);
                        let total_actual = actual_g_forward.get(&current).unwrap_or(&f64::INFINITY)
                            + actual_g_backward.get(&current).unwrap_or(&f64::INFINITY);
                        if total_cost < best_cost {
                            best_cost = total_cost;
                            best_actual_dist = total_actual;
                            meeting_node = Some(current);
                        }
                    }

                    let current_g = *g_backward.get(&current).unwrap_or(&f64::INFINITY);
                    let current_actual = *actual_g_backward.get(&current).unwrap_or(&0.0);

                    if let Some(neighbors) = self.adjacency.get(&current) {
                        for edge in neighbors {
                            if visited_backward.contains(&edge.to) {
                                continue;
                            }
                            let edge_cost = self.get_edge_cost(edge);
                            let tentative_g = current_g + edge_cost;
                            if tentative_g < *g_backward.get(&edge.to).unwrap_or(&f64::INFINITY) {
                                prev_backward.insert(edge.to, current);
                                g_backward.insert(edge.to, tentative_g);
                                actual_g_backward.insert(edge.to, current_actual + edge.distance);
                                let f = tentative_g + h_backward(edge.to);
                                pq_backward.push(edge.to, std::cmp::Reverse(f));
                            }
                        }
                    }
                }
            }
        }

        let meet = meeting_node?;

        let mut path_forward = Vec::new();
        let mut cur = meet;
        while cur != start {
            path_forward.push(cur);
            cur = *prev_forward.get(&cur)?;
        }
        path_forward.push(start);
        path_forward.reverse();

        let mut path_backward = Vec::new();
        cur = meet;
        while cur != end {
            cur = *prev_backward.get(&cur)?;
            path_backward.push(cur);
        }

        path_forward.extend(path_backward);
        Some((path_forward, best_actual_dist, best_cost))
    }

    fn snap_to_road(&self, coord: &Coordinate) -> SnapResult {
        match self.find_nearest_edge_fast(coord) {
            Some((distance, snapped, edge, _)) => SnapResult {
                success: distance < 500.0,
                original: coord.clone(),
                snapped,
                edge: Some(edge),
                distance,
            },
            None => SnapResult {
                success: false,
                original: coord.clone(),
                snapped: coord.clone(),
                edge: None,
                distance: f64::INFINITY,
            },
        }
    }

    fn get_path_coordinates(&self, node_ids: &[i64]) -> Vec<Coordinate> {
        node_ids
            .iter()
            .filter_map(|id| self.nodes.get(id).map(|n| n.coord.clone()))
            .collect()
    }

    fn generate_trip(
        &self,
        path: Vec<Coordinate>,
        speed_kmh: f64,
        interval_ms: f64,
    ) -> Vec<TripStep> {
        if path.len() < 2 {
            return Vec::new();
        }

        let speed = speed_kmh * 1000.0 / 3600.0;
        let step_distance = speed * interval_ms / 1000.0;

        let mut trip = Vec::new();
        let mut timestamp = 0.0;
        let mut total_fuel = 0.0;
        let mut total_electric = 0.0;

        for i in 0..path.len() - 1 {
            let from = &path[i];
            let to = &path[i + 1];
            let edge_dist = Self::haversine_distance(from, to);
            if edge_dist < 0.01 {
                continue;
            }
            let num_steps = (edge_dist / step_distance).max(1.0) as usize;

            for j in 0..=num_steps {
                let t = j as f64 / num_steps as f64;
                let raw_coord = Coordinate {
                    lat: from.lat + (to.lat - from.lat) * t,
                    lon: from.lon + (to.lon - from.lon) * t,
                };

                let snapped_coord = self.snap_point_to_path_segment(&raw_coord, from, to);
                let (multiplier, in_congestion) = self.get_congestion_multiplier(&snapped_coord);

                let step_dist = if j == 0 {
                    0.0
                } else {
                    edge_dist / num_steps as f64
                };

                let energy = self.calculate_energy_consumption(step_dist, speed_kmh, multiplier);
                total_fuel += energy.totalFuelLiters;
                total_electric += energy.totalElectricKwh;

                trip.push(TripStep {
                    coord: snapped_coord,
                    edge_index: i,
                    progress: t,
                    timestamp,
                    speed: speed_kmh,
                    fuelUsed: total_fuel,
                    electricUsed: total_electric,
                    inCongestion: in_congestion,
                    congestionMultiplier: multiplier,
                    currentFuelRate: energy.fuelRateLPer100Km,
                    currentElectricRate: energy.electricRateKwhPer100Km,
                });
                timestamp += interval_ms;
            }
        }

        trip
    }

    fn snap_point_to_path_segment(
        &self,
        point: &Coordinate,
        seg_from: &Coordinate,
        seg_to: &Coordinate,
    ) -> Coordinate {
        let (_, proj, _) = Self::point_to_line_distance(point, seg_from, seg_to);
        proj
    }
}

lazy_static::lazy_static! {
    static ref GRAPH: Mutex<Option<RoutingGraph>> = Mutex::new(None);
}

#[napi(object)]
pub struct JsCoordinate {
    pub lat: f64,
    pub lon: f64,
}

impl From<Coordinate> for JsCoordinate {
    fn from(c: Coordinate) -> Self {
        JsCoordinate { lat: c.lat, lon: c.lon }
    }
}

impl From<JsCoordinate> for Coordinate {
    fn from(c: JsCoordinate) -> Self {
        Coordinate { lat: c.lat, lon: c.lon }
    }
}

#[napi(object)]
pub struct JsCongestionZone {
    pub id: String,
    pub center: JsCoordinate,
    pub radius: f64,
    pub multiplier: f64,
    pub color: String,
}

impl From<CongestionZone> for JsCongestionZone {
    fn from(z: CongestionZone) -> Self {
        JsCongestionZone {
            id: z.id,
            center: z.center.into(),
            radius: z.radius,
            multiplier: z.multiplier,
            color: z.color,
        }
    }
}

impl From<JsCongestionZone> for CongestionZone {
    fn from(z: JsCongestionZone) -> Self {
        CongestionZone {
            id: z.id,
            center: z.center.into(),
            radius: z.radius,
            multiplier: z.multiplier,
            color: z.color,
        }
    }
}

#[napi(object)]
pub struct JsEnergyConsumption {
    pub totalFuelLiters: f64,
    pub totalElectricKwh: f64,
    pub cost: f64,
    pub fuelRateLPer100Km: f64,
    pub electricRateKwhPer100Km: f64,
    pub idleTimeSeconds: f64,
}

impl From<EnergyConsumption> for JsEnergyConsumption {
    fn from(e: EnergyConsumption) -> Self {
        JsEnergyConsumption {
            totalFuelLiters: e.totalFuelLiters,
            totalElectricKwh: e.totalElectricKwh,
            cost: e.cost,
            fuelRateLPer100Km: e.fuelRateLPer100Km,
            electricRateKwhPer100Km: e.electricRateKwhPer100Km,
            idleTimeSeconds: e.idleTimeSeconds,
        }
    }
}

#[napi(object)]
pub struct JsRouteResult {
    pub success: bool,
    pub distance: f64,
    pub duration: f64,
    pub path: Vec<JsCoordinate>,
    pub nodes: Vec<i64>,
    pub algorithm: String,
    pub message: Option<String>,
    pub energy: Option<JsEnergyConsumption>,
    pub congestionAvoided: bool,
}

#[napi(object)]
pub struct JsSnapResult {
    pub success: bool,
    pub original: JsCoordinate,
    pub snapped: JsCoordinate,
    pub distance: f64,
}

#[napi(object)]
pub struct JsTripStep {
    pub coord: JsCoordinate,
    pub edge_index: u32,
    pub progress: f64,
    pub timestamp: f64,
    pub speed: f64,
    pub fuelUsed: f64,
    pub electricUsed: f64,
    pub inCongestion: bool,
    pub congestionMultiplier: f64,
    pub currentFuelRate: f64,
    pub currentElectricRate: f64,
}

#[napi]
pub fn loadOsmPbf(path: String) -> bool {
    let mut graph = RoutingGraph::new();
    match graph.load_pbf(&path) {
        Ok(_) => {
            *GRAPH.lock().unwrap() = Some(graph);
            true
        }
        Err(e) => {
            eprintln!("Error loading OSM PBF: {}", e);
            false
        }
    }
}

#[napi]
pub fn isGraphLoaded() -> bool {
    GRAPH.lock().unwrap().is_some()
}

#[napi]
pub fn getNodeCount() -> u32 {
    GRAPH
        .lock()
        .unwrap()
        .as_ref()
        .map(|g| g.nodes.len() as u32)
        .unwrap_or(0)
}

#[napi]
pub fn getEdgeCount() -> u32 {
    GRAPH
        .lock()
        .unwrap()
        .as_ref()
        .map(|g| g.edges.len() as u32)
        .unwrap_or(0)
}

#[napi]
pub fn addCongestionZone(zone: JsCongestionZone) -> bool {
    let mut guard = match GRAPH.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    let graph = match guard.as_mut() {
        Some(g) => g,
        None => return false,
    };
    graph.add_congestion_zone(zone.into());
    true
}

#[napi]
pub fn removeCongestionZone(zoneId: String) -> bool {
    let mut guard = match GRAPH.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    let graph = match guard.as_mut() {
        Some(g) => g,
        None => return false,
    };
    graph.remove_congestion_zone(&zoneId)
}

#[napi]
pub fn clearCongestionZones() -> bool {
    let mut guard = match GRAPH.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    let graph = match guard.as_mut() {
        Some(g) => g,
        None => return false,
    };
    graph.clear_congestion_zones();
    true
}

#[napi]
pub fn getCongestionZones() -> Vec<JsCongestionZone> {
    let guard = match GRAPH.lock() {
        Ok(g) => g,
        Err(_) => return Vec::new(),
    };
    let graph = match guard.as_ref() {
        Some(g) => g,
        None => return Vec::new(),
    };
    graph
        .get_congestion_zones()
        .into_iter()
        .map(|z| z.into())
        .collect()
}

#[napi]
pub fn planRoute(
    start: JsCoordinate,
    end: JsCoordinate,
    algorithm: String,
) -> JsRouteResult {
    let graph_guard = match GRAPH.lock() {
        Ok(guard) => guard,
        Err(e) => {
            return JsRouteResult {
                success: false,
                distance: 0.0,
                duration: 0.0,
                path: Vec::new(),
                nodes: Vec::new(),
                algorithm,
                message: Some(format!("Graph lock error: {}", e)),
                energy: None,
                congestionAvoided: false,
            };
        }
    };

    let graph = match graph_guard.as_ref() {
        Some(g) => g,
        None => {
            return JsRouteResult {
                success: false,
                distance: 0.0,
                duration: 0.0,
                path: Vec::new(),
                nodes: Vec::new(),
                algorithm,
                message: Some("Graph not loaded".to_string()),
                energy: None,
                congestionAvoided: false,
            };
        }
    };

    let start_coord: Coordinate = start.into();
    let end_coord: Coordinate = end.into();

    let start_node = graph.find_nearest_node_fast(&start_coord);
    let end_node = graph.find_nearest_node_fast(&end_coord);

    let (start_id, end_id) = match (start_node, end_node) {
        (Some(s), Some(e)) => (s, e),
        _ => {
            return JsRouteResult {
                success: false,
                distance: 0.0,
                duration: 0.0,
                path: Vec::new(),
                nodes: Vec::new(),
                algorithm,
                message: Some("Could not find nearby nodes".to_string()),
                energy: None,
                congestionAvoided: false,
            };
        }
    };

    let has_congestion = !graph.congestion_zones.is_empty();
    let algo_lower = algorithm.to_lowercase();
    let result = if algo_lower == "astar" || algo_lower == "a*" {
        graph.bidirectional_a_star(start_id, end_id)
    } else if algo_lower == "dijkstra" {
        graph.dijkstra(start_id, end_id)
    } else {
        graph.bidirectional_a_star(start_id, end_id)
    };

    match result {
        Some((nodes, distance, cost_with_congestion)) => {
            let path = graph.get_path_coordinates(&nodes);
            let avg_speed = 50.0;
            let avg_multiplier = if distance > 0.0 {
                cost_with_congestion / distance
            } else {
                1.0
            };
            let effective_speed = avg_speed / avg_multiplier.max(1.0);
            let duration = distance / (effective_speed * 1000.0 / 3600.0);
            let energy = graph.calculate_energy_consumption(distance, effective_speed, avg_multiplier);
            let congestion_avoided = has_congestion && avg_multiplier > 1.1;

            JsRouteResult {
                success: true,
                distance,
                duration,
                path: path.into_iter().map(|c| c.into()).collect(),
                nodes,
                algorithm,
                message: None,
                energy: Some(energy.into()),
                congestionAvoided: congestion_avoided,
            }
        }
        None => JsRouteResult {
            success: false,
            distance: 0.0,
            duration: 0.0,
            path: Vec::new(),
            nodes: Vec::new(),
            algorithm,
            message: Some("No path found".to_string()),
            energy: None,
            congestionAvoided: false,
        },
    }
}

#[napi]
pub fn snapToRoad(coord: JsCoordinate) -> JsSnapResult {
    let graph_guard = match GRAPH.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return JsSnapResult {
                success: false,
                original: coord,
                snapped: JsCoordinate { lat: 0.0, lon: 0.0 },
                distance: f64::INFINITY,
            };
        }
    };

    let graph = match graph_guard.as_ref() {
        Some(g) => g,
        None => {
            return JsSnapResult {
                success: false,
                original: coord,
                snapped: JsCoordinate { lat: 0.0, lon: 0.0 },
                distance: f64::INFINITY,
            };
        }
    };

    let result = graph.snap_to_road(&coord.into());
    JsSnapResult {
        success: result.success,
        original: result.original.into(),
        snapped: result.snapped.into(),
        distance: result.distance,
    }
}

#[napi]
pub fn generateTrip(
    path: Vec<JsCoordinate>,
    speedKmh: f64,
    intervalMs: f64,
) -> Vec<JsTripStep> {
    let graph_guard = match GRAPH.lock() {
        Ok(guard) => guard,
        Err(_) => return Vec::new(),
    };

    let graph = match graph_guard.as_ref() {
        Some(g) => g,
        None => return Vec::new(),
    };

    let coords: Vec<Coordinate> = path.into_iter().map(|c| c.into()).collect();
    let trip = graph.generate_trip(coords, speedKmh, intervalMs);

    trip.into_iter()
        .map(|s| JsTripStep {
            coord: s.coord.into(),
            edge_index: s.edge_index as u32,
            progress: s.progress,
            timestamp: s.timestamp,
            speed: s.speed,
            fuelUsed: s.fuelUsed,
            electricUsed: s.electricUsed,
            inCongestion: s.inCongestion,
            congestionMultiplier: s.congestionMultiplier,
            currentFuelRate: s.currentFuelRate,
            currentElectricRate: s.currentElectricRate,
        })
        .collect()
}
