use crate::models::{AlertQueryParams, AlertRule, Condition, CreateAlertRuleRequest};
use crate::rules::SharedRuleEngine;
use crate::storage::SharedStorage;
use actix_web::{web, HttpResponse, Responder};
use serde::Deserialize;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct AlertQuery {
    pub fan_id: Option<String>,
    pub rule_id: Option<Uuid>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateConditionRequest {
    pub condition: Condition,
}

#[derive(Debug, Deserialize)]
pub struct SetEnabledRequest {
    pub enabled: bool,
}

pub async fn create_rule(
    rule_engine: web::Data<SharedRuleEngine>,
    request: web::Json<CreateAlertRuleRequest>,
) -> impl Responder {
    let rule = rule_engine.add_rule(request.into_inner());
    HttpResponse::Created().json(rule)
}

pub async fn get_rules(rule_engine: web::Data<SharedRuleEngine>) -> impl Responder {
    let rules = rule_engine.get_rules();
    HttpResponse::Ok().json(rules)
}

pub async fn get_rule(
    rule_engine: web::Data<SharedRuleEngine>,
    path: web::Path<Uuid>,
) -> impl Responder {
    let id = path.into_inner();
    match rule_engine.get_rule(id) {
        Some(rule) => HttpResponse::Ok().json(rule),
        None => HttpResponse::NotFound().json(serde_json::json!({"error": "Rule not found"})),
    }
}

pub async fn delete_rule(
    rule_engine: web::Data<SharedRuleEngine>,
    path: web::Path<Uuid>,
) -> impl Responder {
    let id = path.into_inner();
    if rule_engine.delete_rule(id) {
        HttpResponse::Ok().json(serde_json::json!({"message": "Rule deleted"}))
    } else {
        HttpResponse::NotFound().json(serde_json::json!({"error": "Rule not found"}))
    }
}

pub async fn update_rule_condition(
    rule_engine: web::Data<SharedRuleEngine>,
    path: web::Path<Uuid>,
    request: web::Json<UpdateConditionRequest>,
) -> impl Responder {
    let id = path.into_inner();
    match rule_engine.update_rule_condition(id, request.condition.clone()) {
        Some(rule) => HttpResponse::Ok().json(rule),
        None => HttpResponse::NotFound().json(serde_json::json!({"error": "Rule not found"})),
    }
}

pub async fn set_rule_enabled(
    rule_engine: web::Data<SharedRuleEngine>,
    path: web::Path<Uuid>,
    request: web::Json<SetEnabledRequest>,
) -> impl Responder {
    let id = path.into_inner();
    match rule_engine.set_rule_enabled(id, request.enabled) {
        Some(rule) => HttpResponse::Ok().json(rule),
        None => HttpResponse::NotFound().json(serde_json::json!({"error": "Rule not found"})),
    }
}

pub async fn get_alerts(
    storage: web::Data<SharedStorage>,
    query: web::Query<AlertQuery>,
) -> impl Responder {
    let params = AlertQueryParams {
        fan_id: query.fan_id.clone(),
        rule_id: query.rule_id,
        start_time: query.start_time.as_ref().and_then(|s| {
            chrono::DateTime::parse_from_rfc3339(s)
                .ok()
                .map(|dt| dt.with_timezone(&chrono::Utc))
        }),
        end_time: query.end_time.as_ref().and_then(|s| {
            chrono::DateTime::parse_from_rfc3339(s)
                .ok()
                .map(|dt| dt.with_timezone(&chrono::Utc))
        }),
        limit: query.limit,
    };

    match storage.query_alerts(params).await {
        Ok(alerts) => HttpResponse::Ok().json(alerts),
        Err(e) => HttpResponse::InternalServerError()
            .json(serde_json::json!({"error": format!("Failed to query alerts: {}", e)})),
    }
}

pub async fn health_check() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({"status": "ok"}))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/api")
            .route("/health", web::get().to(health_check))
            .route("/rules", web::post().to(create_rule))
            .route("/rules", web::get().to(get_rules))
            .route("/rules/{id}", web::get().to(get_rule))
            .route("/rules/{id}", web::delete().to(delete_rule))
            .route("/rules/{id}/condition", web::put().to(update_rule_condition))
            .route("/rules/{id}/enabled", web::put().to(set_rule_enabled))
            .route("/alerts", web::get().to(get_alerts)),
    );
}
