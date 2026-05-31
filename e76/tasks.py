import time
import io
import csv
import threading
import uuid
from typing import List, Dict, Any
from collections import defaultdict
from molecule_utils import validate_smiles
from model import get_model


try:
    from celery import Celery
    CELERY_AVAILABLE = True
except ImportError:
    CELERY_AVAILABLE = False


_in_memory_tasks: Dict[str, Dict[str, Any]] = {}
_tasks_lock = threading.Lock()


def _create_task_id() -> str:
    return str(uuid.uuid4())


def _process_batch_predict(smiles_list: List[str], task_id: str):
    with _tasks_lock:
        _in_memory_tasks[task_id] = {
            "status": "processing",
            "state": "PROGRESS",
            "current": 0,
            "total": len(smiles_list),
            "progress": 0,
            "message": "Starting..."
        }

    model = get_model()
    results = []
    total = len(smiles_list)

    for idx, smiles in enumerate(smiles_list):
        smiles = smiles.strip()
        valid = validate_smiles(smiles)

        if valid:
            logp = model.predict(smiles)
            solubility_class = model._classify_logp(logp)
        else:
            logp = 0.0
            solubility_class = "Invalid"

        results.append({
            "index": idx,
            "smiles": smiles,
            "logp": logp,
            "solubility_class": solubility_class,
            "valid": valid
        })

        if idx % 10 == 0 or idx == total - 1:
            progress = int(((idx + 1) / total) * 100)
            with _tasks_lock:
                _in_memory_tasks[task_id].update({
                    "current": idx + 1,
                    "progress": progress,
                    "message": f"Processed {idx + 1}/{total} molecules"
                })

        time.sleep(0.01)

    csv_output = _results_to_csv(results)

    with _tasks_lock:
        _in_memory_tasks[task_id] = {
            "status": "completed",
            "state": "SUCCESS",
            "total_count": total,
            "success_count": sum(1 for r in results if r["valid"]),
            "results": results,
            "csv_data": csv_output
        }


def _process_csv_predict(csv_content: str, task_id: str):
    try:
        csv_file = io.StringIO(csv_content)
        reader = csv.DictReader(csv_file)

        smiles_list = []
        for row in reader:
            if 'smiles' in row:
                smiles_list.append(row['smiles'].strip())
            elif 'SMILES' in row:
                smiles_list.append(row['SMILES'].strip())
            else:
                first_key = list(row.keys())[0]
                smiles_list.append(row[first_key].strip())

        _process_batch_predict(smiles_list, task_id)

    except Exception as e:
        with _tasks_lock:
            _in_memory_tasks[task_id] = {
                "status": "failed",
                "state": "FAILURE",
                "error": f"Error processing CSV: {str(e)}"
            }


def predict_batch_task_async(smiles_list: List[str]) -> str:
    task_id = _create_task_id()
    thread = threading.Thread(
        target=_process_batch_predict,
        args=(smiles_list, task_id),
        daemon=True
    )
    thread.start()
    return task_id


def predict_csv_task_async(csv_content: str) -> str:
    task_id = _create_task_id()
    thread = threading.Thread(
        target=_process_csv_predict,
        args=(csv_content, task_id),
        daemon=True
    )
    thread.start()
    return task_id


def _results_to_csv(results: List[Dict[str, Any]]) -> str:
    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=["smiles", "logp", "solubility_class", "valid"]
    )
    writer.writeheader()
    for r in results:
        writer.writerow({
            "smiles": r["smiles"],
            "logp": r["logp"],
            "solubility_class": r["solubility_class"],
            "valid": r["valid"]
        })
    return output.getvalue()


def get_task_status(task_id: str) -> Dict[str, Any]:
    with _tasks_lock:
        task_data = _in_memory_tasks.get(task_id)

    if task_data is None:
        return {
            "task_id": task_id,
            "status": "not_found",
            "state": "NOT_FOUND",
            "message": "Task not found"
        }

    result = {"task_id": task_id, **task_data}

    if result["status"] == "processing":
        result["message"] = result.get("message", "Processing...")

    return result


if CELERY_AVAILABLE:
    try:
        celery_app = Celery("logp_tasks")
        celery_app.config_from_object("celery_config")

        _model = None

        def get_prediction_model():
            global _model
            if _model is None:
                _model = get_model()
            return _model

        @celery_app.task(bind=True, name="predict_batch_task")
        def predict_batch_task(self, smiles_list: List[str]) -> Dict[str, Any]:
            self.update_state(state="PROGRESS", meta={"current": 0, "total": len(smiles_list), "status": "Starting..."})

            model = get_prediction_model()
            results = []
            total = len(smiles_list)

            for idx, smiles in enumerate(smiles_list):
                smiles = smiles.strip()
                valid = validate_smiles(smiles)

                if valid:
                    logp = model.predict(smiles)
                    solubility_class = model._classify_logp(logp)
                else:
                    logp = 0.0
                    solubility_class = "Invalid"

                results.append({
                    "index": idx,
                    "smiles": smiles,
                    "logp": logp,
                    "solubility_class": solubility_class,
                    "valid": valid
                })

                if idx % 10 == 0 or idx == total - 1:
                    progress = int(((idx + 1) / total) * 100)
                    self.update_state(
                        state="PROGRESS",
                        meta={
                            "current": idx + 1,
                            "total": total,
                            "progress": progress,
                            "status": f"Processed {idx + 1}/{total} molecules"
                        }
                    )

                time.sleep(0.01)

            csv_output = _results_to_csv(results)

            return {
                "total_count": total,
                "success_count": sum(1 for r in results if r["valid"]),
                "results": results,
                "csv_data": csv_output
            }

        @celery_app.task(bind=True, name="predict_csv_task")
        def predict_csv_task(self, csv_content: str) -> Dict[str, Any]:
            try:
                csv_file = io.StringIO(csv_content)
                reader = csv.DictReader(csv_file)

                smiles_list = []
                for row in reader:
                    if 'smiles' in row:
                        smiles_list.append(row['smiles'].strip())
                    elif 'SMILES' in row:
                        smiles_list.append(row['SMILES'].strip())
                    else:
                        first_key = list(row.keys())[0]
                        smiles_list.append(row[first_key].strip())

                return predict_batch_task.apply(args=[smiles_list]).get()

            except Exception as e:
                return {"error": f"Error processing CSV: {str(e)}"}

        def get_task_status_celery(task_id: str) -> Dict[str, Any]:
            task = predict_batch_task.AsyncResult(task_id)

            if task.state == "PENDING":
                return {
                    "task_id": task_id,
                    "status": "pending",
                    "state": task.state,
                    "message": "Task is waiting in queue..."
                }
            elif task.state == "PROGRESS":
                meta = task.info
                return {
                    "task_id": task_id,
                    "status": "processing",
                    "state": task.state,
                    "current": meta.get("current", 0),
                    "total": meta.get("total", 0),
                    "progress": meta.get("progress", 0),
                    "message": meta.get("status", "Processing...")
                }
            elif task.state == "SUCCESS":
                result = task.result
                return {
                    "task_id": task_id,
                    "status": "completed",
                    "state": task.state,
                    "total_count": result.get("total_count", 0),
                    "success_count": result.get("success_count", 0),
                    "results": result.get("results", []),
                    "csv_data": result.get("csv_data", "")
                }
            elif task.state == "FAILURE":
                return {
                    "task_id": task_id,
                    "status": "failed",
                    "state": task.state,
                    "error": str(task.info) if task.info else "Unknown error"
                }
            else:
                return {
                    "task_id": task_id,
                    "status": task.state.lower(),
                    "state": task.state
                }

        USE_CELERY = True

    except Exception as e:
        print(f"[tasks] Celery initialization failed, using in-memory tasks: {e}")
        USE_CELERY = False
else:
    USE_CELERY = False
    celery_app = None


def submit_batch_task(smiles_list: List[str]) -> str:
    if USE_CELERY and CELERY_AVAILABLE:
        task = predict_batch_task.delay(smiles_list)
        return task.id
    else:
        return predict_batch_task_async(smiles_list)


def submit_csv_task(csv_content: str) -> str:
    if USE_CELERY and CELERY_AVAILABLE:
        task = predict_csv_task.delay(csv_content)
        return task.id
    else:
        return predict_csv_task_async(csv_content)


def get_task_status_universal(task_id: str) -> Dict[str, Any]:
    if USE_CELERY and CELERY_AVAILABLE:
        return get_task_status_celery(task_id)
    else:
        return get_task_status(task_id)
