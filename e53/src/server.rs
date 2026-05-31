use crate::data::{QueryResponse, QueryResult, Sample, SeriesKey, WriteRequest};
use crate::downsampling::{DownsamplingManager, DownsamplingRule};
use crate::lsm::LsmMetrics;
use crate::promql::{Evaluator, Expr, QueryContext};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post, delete},
    Json, Router,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tracing::info;

#[derive(Clone)]
pub struct AppState {
    pub evaluator: Arc<Evaluator>,
    pub lsm: Arc<crate::lsm::LsmTree>,
    pub downsampling_manager: Arc<DownsamplingManager>,
}

#[derive(Debug, Deserialize)]
pub struct QueryParams {
    query: String,
    start: Option<i64>,
    end: Option<i64>,
    step: Option<i64>,
}

async fn write_metric(
    State(state): State<AppState>,
    Json(request): Json<WriteRequest>,
) -> impl IntoResponse {
    let key = SeriesKey::new(request.metric, request.tags);
    let sample = Sample::new(request.timestamp, request.value);

    match state.evaluator.lsm.insert(key, sample) {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({"status": "success"}))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"status": "error", "error": e.to_string()})),
        ),
    }
}

async fn query_metric(
    State(state): State<AppState>,
    Query(params): Query<QueryParams>,
) -> impl IntoResponse {
    let expr = match Expr::parse(&params.query) {
        Ok(expr) => expr,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"status": "error", "error": e.to_string()})),
            )
        }
    };

    let now = chrono::Utc::now().timestamp_millis();
    let ctx = QueryContext {
        start: params.start.unwrap_or_else(|| now - 3600 * 1000),
        end: params.end.unwrap_or(now),
        step: params.step.unwrap_or(60 * 1000),
    };

    match state.evaluator.evaluate(&expr, &ctx) {
        Ok(results) => {
            let query_results = results
                .into_iter()
                .map(|(key, values)| QueryResult {
                    metric: key.metric,
                    tags: key.tags,
                    values,
                })
                .collect();

            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "status": "success",
                    "data": QueryResponse {
                        results: query_results
                    }
                })),
            )
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"status": "error", "error": e.to_string()})),
        ),
    }
}

async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({"status": "ok"}))
}

async fn get_metrics(State(state): State<AppState>) -> impl IntoResponse {
    let metrics = state.lsm.get_metrics();
    (StatusCode::OK, Json(metrics))
}

async fn list_downsampling_rules(State(state): State<AppState>) -> impl IntoResponse {
    let rules = state.downsampling_manager.get_rules();
    (StatusCode::OK, Json(rules))
}

async fn add_downsampling_rule(
    State(state): State<AppState>,
    Json(rule): Json<DownsamplingRule>,
) -> impl IntoResponse {
    state.downsampling_manager.add_rule(rule.clone());
    info!("Added new downsampling rule: {}", rule.metric_pattern);
    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "status": "success",
            "message": "Downsampling rule added successfully"
        })),
    )
}

async fn delete_downsampling_rule(
    State(state): State<AppState>,
    Path(index): Path<usize>,
) -> impl IntoResponse {
    match state.downsampling_manager.remove_rule(index) {
        Some(_) => {
            info!("Removed downsampling rule at index: {}", index);
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "status": "success",
                    "message": "Downsampling rule removed successfully"
                })),
            )
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "status": "error",
                "message": "Downsampling rule not found"
            })),
        ),
    }
}

pub fn create_router(
    evaluator: Arc<Evaluator>,
    lsm: Arc<crate::lsm::LsmTree>,
    downsampling_manager: Arc<DownsamplingManager>,
) -> Router {
    let state = AppState {
        evaluator,
        lsm,
        downsampling_manager,
    };

    Router::new()
        .route("/write", post(write_metric))
        .route("/query", get(query_metric))
        .route("/metrics", get(get_metrics))
        .route("/health", get(health_check))
        .route("/downsampling/rules", get(list_downsampling_rules))
        .route("/downsampling/rules", post(add_downsampling_rule))
        .route("/downsampling/rules/:index", delete(delete_downsampling_rule))
        .with_state(state)
}

pub async fn run_server(
    evaluator: Arc<Evaluator>,
    lsm: Arc<crate::lsm::LsmTree>,
    downsampling_manager: Arc<DownsamplingManager>,
    host: String,
    port: u16,
) {
    let app = create_router(evaluator, lsm, downsampling_manager);
    let addr = format!("{}:{}", host, port);
    info!("Server listening on {}", addr);

    axum::Server::bind(&addr.parse().unwrap())
        .serve(app.into_make_service())
        .await
        .unwrap();
}
