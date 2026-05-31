use crate::data::{Sample, SeriesKey};
use crate::downsampling::DownsamplingManager;
use crate::lsm::LsmTree;
use nom::{
    bytes::complete::{tag, take_until},
    character::complete::{alphanumeric1, digit1, multispace0},
    combinator::{map, map_res},
    multi::many0,
    sequence::{delimited, pair, preceded, separated_pair, terminated},
    IResult,
};
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum PromQLError {
    #[error("Parse error: {0}")]
    Parse(String),
    #[error("LSM error: {0}")]
    Lsm(#[from] crate::lsm::LsmError),
    #[error("Evaluation error: {0}")]
    Evaluation(String),
}

pub type Result<T> = std::result::Result<T, PromQLError>;

#[derive(Debug, Clone)]
pub enum Expr {
    MetricSelector(MetricSelector),
    Rate(Box<Expr>, i64),
    Avg(Box<Expr>),
}

#[derive(Debug, Clone)]
pub struct MetricSelector {
    pub metric: String,
    pub tags: HashMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct QueryContext {
    pub start: i64,
    pub end: i64,
    pub step: i64,
}

fn parse_metric(input: &str) -> IResult<&str, String> {
    map(alphanumeric1, |s: &str| s.to_string())(input)
}

fn parse_tag_value(input: &str) -> IResult<&str, String> {
    delimited(tag("\""), take_until("\""), tag("\""))(input)
        .map(|(rest, s)| (rest, s.to_string()))
}

fn parse_tag(input: &str) -> IResult<&str, (String, String)> {
    separated_pair(
        map(alphanumeric1, |s: &str| s.to_string()),
        pair(multispace0, tag("="), multispace0),
        parse_tag_value,
    )(input)
}

fn parse_tag_list(input: &str) -> IResult<&str, HashMap<String, String>> {
    let (input, first) = parse_tag(input)?;
    let (input, rest) = many0(preceded(pair(tag(","), multispace0), parse_tag))(input)?;
    let mut tags = HashMap::new();
    tags.insert(first.0, first.1);
    for (k, v) in rest {
        tags.insert(k, v);
    }
    Ok((input, tags))
}

fn parse_metric_selector(input: &str) -> IResult<&str, MetricSelector> {
    let (input, metric) = parse_metric(input)?;
    let (input, tags) = delimited(
        pair(tag("{"), multispace0),
        parse_tag_list,
        pair(multispace0, tag("}")),
    )(input)?;
    Ok((input, MetricSelector { metric, tags }))
}

fn parse_duration(input: &str) -> IResult<&str, i64> {
    let (input, digits) = digit1(input)?;
    let (input, unit) = alphanumeric1(input)?;
    let num: i64 = digits.parse().map_err(|_| nom::Err::Error(nom::error::make_error(input, nom::error::ErrorKind::ParseToInt)))?;
    let multiplier = match unit {
        "s" => 1000,
        "m" => 60 * 1000,
        "h" => 60 * 60 * 1000,
        "d" => 24 * 60 * 60 * 1000,
        _ => return Err(nom::Err::Error(nom::error::make_error(input, nom::error::ErrorKind::Tag))),
    };
    Ok((input, num * multiplier))
}

fn parse_rate(input: &str) -> IResult<&str, Expr> {
    let (input, _) = tag("rate")(input)?;
    let (input, _) = pair(multispace0, tag("("), multispace0)(input)?;
    let (input, selector) = parse_metric_selector(input)?;
    let (input, _) = pair(multispace0, tag("["), multispace0)(input)?;
    let (input, duration) = parse_duration(input)?;
    let (input, _) = pair(multispace0, tag("]"), multispace0)(input)?;
    let (input, _) = pair(multispace0, tag(")"), multispace0)(input)?;
    Ok((input, Expr::Rate(Box::new(Expr::MetricSelector(selector)), duration)))
}

fn parse_avg(input: &str) -> IResult<&str, Expr> {
    let (input, _) = tag("avg")(input)?;
    let (input, _) = pair(multispace0, tag("("), multispace0)(input)?;
    let (input, expr) = parse_expr(input)?;
    let (input, _) = pair(multispace0, tag(")"), multispace0)(input)?;
    Ok((input, Expr::Avg(Box::new(expr))))
}

fn parse_expr(input: &str) -> IResult<&str, Expr> {
    if input.starts_with("rate") {
        parse_rate(input)
    } else if input.starts_with("avg") {
        parse_avg(input)
    } else {
        map(parse_metric_selector, Expr::MetricSelector)(input)
    }
}

impl Expr {
    pub fn parse(input: &str) -> Result<Self> {
        match parse_expr(input) {
            Ok((_, expr)) => Ok(expr),
            Err(e) => Err(PromQLError::Parse(format!("{}", e))),
        }
    }
}

pub struct Evaluator {
    lsm: Arc<LsmTree>,
    downsampling_manager: Option<Arc<DownsamplingManager>>,
}

impl Evaluator {
    pub fn new(lsm: Arc<LsmTree>) -> Self {
        Self {
            lsm,
            downsampling_manager: None,
        }
    }

    pub fn with_downsampling(mut self, dm: Arc<DownsamplingManager>) -> Self {
        self.downsampling_manager = Some(dm);
        self
    }

    pub fn evaluate(&self, expr: &Expr, ctx: &QueryContext) -> Result<Vec<(SeriesKey, Vec<(i64, f64)>)>> {
        match expr {
            Expr::MetricSelector(selector) => self.evaluate_selector(selector, ctx),
            Expr::Rate(expr, window) => self.evaluate_rate(expr, *window, ctx),
            Expr::Avg(expr) => self.evaluate_avg(expr, ctx),
        }
    }

    fn evaluate_selector(&self, selector: &MetricSelector, ctx: &QueryContext) -> Result<Vec<(SeriesKey, Vec<(i64, f64)>)>> {
        let mut results = Vec::new();
        let all_series = self.lsm.get_all_series_keys()?;

        for key in all_series {
            if key.metric != selector.metric {
                continue;
            }

            let mut tags_match = true;
            for (k, v) in &selector.tags {
                if key.tags.get(k) != Some(v) {
                    tags_match = false;
                    break;
                }
            }
            if !tags_match {
                continue;
            }

            let samples = if let Some(dm) = &self.downsampling_manager {
                let query_range = ctx.end - ctx.start;
                if let Some((resolution_ms, aggregation)) = dm.find_best_resolution(&key.metric, ctx.start, ctx.end) {
                    let agg_str = match aggregation {
                        crate::downsampling::AggregationType::Avg => "avg",
                        crate::downsampling::AggregationType::Max => "max",
                        crate::downsampling::AggregationType::Min => "min",
                        crate::downsampling::AggregationType::Sum => "sum",
                        crate::downsampling::AggregationType::Count => "count",
                    };
                    
                    let downsampled_metric = format!("{}_downsampled_{}_{}", key.metric, resolution_ms, agg_str);
                    let mut downsampled_tags = key.tags.clone();
                    downsampled_tags.insert("resolution_ms".to_string(), resolution_ms.to_string());
                    downsampled_tags.insert("aggregation".to_string(), agg_str.to_string());
                    
                    let downsampled_key = SeriesKey::new(downsampled_metric, downsampled_tags);
                    let downsampled_samples = self.lsm.query(&downsampled_key, ctx.start, ctx.end)?;
                    
                    if !downsampled_samples.is_empty() {
                        tracing::debug!(
                            "Using downsampled data: {}ms resolution for query range {}s",
                            resolution_ms,
                            query_range / 1000
                        );
                        downsampled_samples
                    } else {
                        self.lsm.query(&key, ctx.start, ctx.end)?
                    }
                } else {
                    self.lsm.query(&key, ctx.start, ctx.end)?
                }
            } else {
                self.lsm.query(&key, ctx.start, ctx.end)?
            };

            let values = self.resample(&samples, ctx);
            results.push((key, values));
        }

        Ok(results)
    }

    fn resample(&self, samples: &[Sample], ctx: &QueryContext) -> Vec<(i64, f64)> {
        if samples.is_empty() {
            return Vec::new();
        }

        let mut result = Vec::new();
        let mut t = ctx.start;
        let mut sample_idx = 0;

        while t <= ctx.end {
            while sample_idx + 1 < samples.len() && samples[sample_idx + 1].timestamp <= t {
                sample_idx += 1;
            }

            let value = samples[sample_idx].value;
            result.push((t, value));

            t += ctx.step;
        }

        result
    }

    fn evaluate_rate(&self, expr: &Expr, window: i64, ctx: &QueryContext) -> Result<Vec<(SeriesKey, Vec<(i64, f64)>)>> {
        let series_list = self.evaluate(expr, ctx)?;
        let mut results = Vec::new();

        for (key, values) in series_list {
            let mut rate_values = Vec::new();
            for i in 0..values.len() {
                let (t, current) = values[i];
                let mut prev_val = current;
                let mut prev_t = t - window;

                for j in (0..i).rev() {
                    if values[j].0 >= t - window {
                        prev_val = values[j].1;
                        prev_t = values[j].0;
                    } else {
                        break;
                    }
                }

                let dt = t - prev_t;
                let rate = if dt > 0 {
                    (current - prev_val) / (dt as f64 / 1000.0)
                } else {
                    0.0
                };
                rate_values.push((t, rate));
            }
            results.push((key, rate_values));
        }

        Ok(results)
    }

    fn evaluate_avg(&self, expr: &Expr, ctx: &QueryContext) -> Result<Vec<(SeriesKey, Vec<(i64, f64)>)>> {
        let series_list = self.evaluate(expr, ctx)?;
        if series_list.is_empty() {
            return Ok(Vec::new());
        }

        let num_points = series_list[0].1.len();
        let mut avg_values = vec![(0i64, 0f64); num_points];

        for i in 0..num_points {
            let mut sum = 0.0;
            let mut count = 0;
            let mut timestamp = 0;

            for (_, values) in &series_list {
                if i < values.len() {
                    timestamp = values[i].0;
                    sum += values[i].1;
                    count += 1;
                }
            }

            if count > 0 {
                avg_values[i] = (timestamp, sum / count as f64);
            }
        }

        let avg_key = SeriesKey::new("avg_result".to_string(), HashMap::new());
        Ok(vec![(avg_key, avg_values)])
    }
}
