import json
import requests
import re
from typing import Dict, Any, List, Tuple
from datetime import datetime

from config import settings


class LLMAnalyzer:
    def __init__(self):
        self.base_url = settings.OLLAMA_BASE_URL
        self.model = settings.OLLAMA_MODEL

    def _call_ollama(self, prompt: str, system_prompt: str = None) -> str:
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.2,
                "top_p": 0.9,
                "num_ctx": 8192,
                "repeat_penalty": 1.1
            }
        }

        if system_prompt:
            payload["system"] = system_prompt

        try:
            response = requests.post(
                f"{self.base_url}/api/generate",
                json=payload,
                timeout=600
            )
            response.raise_for_status()
            result = response.json()
            return result.get("response", "")
        except Exception as e:
            print(f"Error calling Ollama: {e}")
            raise

    def _get_json_schema_prompt(self) -> str:
        schema = {
            "type": "object",
            "required": ["decisions", "todos", "disputes", "summary"],
            "properties": {
                "decisions": {
                    "type": "array",
                    "description": "会议中明确做出的决定、结论或行动计划",
                    "items": {
                        "type": "string",
                        "description": "具体的决策内容"
                    }
                },
                "todos": {
                    "type": "array",
                    "description": "需要后续执行的任务",
                    "items": {
                        "type": "object",
                        "required": ["task"],
                        "properties": {
                            "task": {
                                "type": "string",
                                "description": "任务描述"
                            },
                            "assignee": {
                                "type": "string",
                                "description": "负责人，如未指定则填\"未指定\""
                            },
                            "deadline": {
                                "type": "string",
                                "description": "截止日期，如未指定则填\"未指定\"，格式如\"2024-12-31\"或\"下周五\""
                            },
                            "priority": {
                                "type": "string",
                                "enum": ["high", "medium", "low"],
                                "description": "任务优先级，默认medium"
                            }
                        }
                    }
                },
                "disputes": {
                    "type": "array",
                    "description": "会议中讨论的有分歧、未达成一致的问题",
                    "items": {
                        "type": "object",
                        "required": ["issue", "points"],
                        "properties": {
                            "issue": {
                                "type": "string",
                                "description": "争议问题描述"
                            },
                            "points": {
                                "type": "array",
                                "description": "各方观点",
                                "items": {
                                    "type": "string",
                                    "description": "具体观点"
                                }
                            }
                        }
                    }
                },
                "summary": {
                    "type": "string",
                    "description": "会议的简短摘要，100-300字"
                }
            }
        }

        return json.dumps(schema, ensure_ascii=False, indent=2)

    def _extract_json_robust(self, text: str) -> Dict[str, Any]:
        text = text.strip()

        json_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
        if json_match:
            json_str = json_match.group(1).strip()
            try:
                return json.loads(json_str)
            except json.JSONDecodeError:
                pass

        json_match = re.search(r'\{[\s\S]*\}', text)
        if json_match:
            json_str = json_match.group(0)
            try:
                return json.loads(json_str)
            except json.JSONDecodeError:
                pass

        lines = text.split('\n')
        json_lines = []
        in_json = False
        brace_count = 0
        for line in lines:
            if '{' in line:
                in_json = True
            if in_json:
                json_lines.append(line)
                brace_count += line.count('{') - line.count('}')
                if brace_count == 0:
                    break
        if json_lines:
            try:
                return json.loads('\n'.join(json_lines))
            except json.JSONDecodeError:
                pass

        return None

    def _regex_extract_todos(self, text: str) -> List[Dict[str, Any]]:
        todos = []

        patterns = [
            r'(?:需要|要|应该|必须)\s*([^。，\n]+?)\s*(?:由|给|让|找)\s*([^。，\n]+?)\s*(?:在|于|截止|前)\s*([^。，\n]+?)\s*(?:完成|做|处理)',
            r'([^。，\n]+?)\s*(?:负责|跟进|处理|完成)\s*([^。，\n]+)',
            r'任务[:：]\s*([^。，\n]+?)(?:\s*负责人[:：]\s*([^。，\n]+?))?(?:\s*截止[:：]\s*([^。，\n]+?))?',
            r'TODO[:：]\s*([^\n]+)',
            r'待办[:：]\s*([^\n]+)',
        ]

        for pattern in patterns:
            matches = re.finditer(pattern, text)
            for match in matches:
                groups = match.groups()
                if len(groups) >= 1 and groups[0].strip():
                    task = groups[0].strip()
                    assignee = groups[1].strip() if len(groups) > 1 and groups[1] else "未指定"
                    deadline = groups[2].strip() if len(groups) > 2 and groups[2] else "未指定"

                    priority = "medium"
                    if any(keyword in task for keyword in ["紧急", "马上", "立即", "重要"]):
                        priority = "high"
                    elif any(keyword in task for keyword in ["以后", "有空", "下次"]):
                        priority = "low"

                    todos.append({
                        "task": task,
                        "assignee": assignee,
                        "deadline": deadline,
                        "priority": priority
                    })

        simple_todo_pattern = r'([^。！？\n]*?(?:完成|做|处理|跟进|准备|发送|提供)[^。！？\n]*)'
        matches = re.finditer(simple_todo_pattern, text)
        for match in matches:
            task = match.group(1).strip()
            if len(task) > 5 and len(task) < 100:
                exists = any(t["task"] == task for t in todos)
                if not exists:
                    todos.append({
                        "task": task,
                        "assignee": "未指定",
                        "deadline": "未指定",
                        "priority": "medium"
                    })

        return todos[:10]

    def _regex_extract_decisions(self, text: str) -> List[str]:
        decisions = []

        patterns = [
            r'(?:决定|确定|同意|通过|达成一致|结论是|最终)[:：]?\s*([^。！？\n]+)',
            r'(?:会议认为|会议决定|会议同意)[:：]?\s*([^。！？\n]+)',
            r'(?:我们|大家|双方)(?:一致|共同)(?:认为|决定|同意)[:：]?\s*([^。！？\n]+)',
        ]

        for pattern in patterns:
            matches = re.finditer(pattern, text)
            for match in matches:
                decision = match.group(1).strip()
                if len(decision) > 3 and len(decision) < 200:
                    if decision not in decisions:
                        decisions.append(decision)

        return decisions

    def _regex_extract_disputes(self, text: str) -> List[Dict[str, Any]]:
        disputes = []

        dispute_keywords = ["但是", "然而", "不过", "另一方面", "反对", "不同意", "有疑问", "存在分歧", "争论", "讨论"]

        sentences = re.split(r'[。！？\n]', text)
        current_dispute = None

        for sentence in sentences:
            if any(keyword in sentence for keyword in ["争议", "分歧", "不同意见", "未达成一致"]):
                if current_dispute:
                    disputes.append(current_dispute)
                current_dispute = {
                    "issue": sentence.strip(),
                    "points": []
                }
            elif current_dispute and any(keyword in sentence for keyword in dispute_keywords):
                current_dispute["points"].append(sentence.strip())
                if len(current_dispute["points"]) >= 5:
                    disputes.append(current_dispute)
                    current_dispute = None

        if current_dispute:
            disputes.append(current_dispute)

        return disputes

    def _regex_extract_summary(self, text: str) -> str:
        if len(text) < 500:
            return text[:300]

        first_paragraph = text.split('\n')[0] if '\n' in text else text
        if len(first_paragraph) > 50:
            return first_paragraph[:300]

        sentences = re.split(r'[。！？]', text)
        important_sentences = []
        for sentence in sentences:
            if any(keyword in sentence for keyword in ["会议", "主要", "讨论", "决定", "总结", "总的来说"]):
                important_sentences.append(sentence.strip())
            if len(important_sentences) >= 3:
                break

        if important_sentences:
            return "。".join(important_sentences)[:300]

        return text[:300]

    def _validate_and_fix_result(self, result: Dict[str, Any], transcription: str) -> Dict[str, Any]:
        if not isinstance(result, dict):
            result = {}

        decisions = result.get("decisions", [])
        if not isinstance(decisions, list) or len(decisions) == 0:
            decisions = self._regex_extract_decisions(transcription)
        result["decisions"] = [d for d in decisions if isinstance(d, str) and d.strip()]

        todos = result.get("todos", [])
        if not isinstance(todos, list) or len(todos) == 0:
            todos = self._regex_extract_todos(transcription)

        valid_todos = []
        for todo in todos:
            if isinstance(todo, dict):
                task = todo.get("task", "").strip()
                if task:
                    valid_todo = {
                        "task": task,
                        "assignee": str(todo.get("assignee", "未指定")).strip() or "未指定",
                        "deadline": str(todo.get("deadline", "未指定")).strip() or "未指定",
                        "priority": str(todo.get("priority", "medium")).strip() or "medium"
                    }
                    if valid_todo["priority"] not in ["high", "medium", "low"]:
                        valid_todo["priority"] = "medium"
                    valid_todos.append(valid_todo)
            elif isinstance(todo, str) and todo.strip():
                valid_todos.append({
                    "task": todo.strip(),
                    "assignee": "未指定",
                    "deadline": "未指定",
                    "priority": "medium"
                })
        result["todos"] = valid_todos

        disputes = result.get("disputes", [])
        if not isinstance(disputes, list) or len(disputes) == 0:
            disputes = self._regex_extract_disputes(transcription)

        valid_disputes = []
        for dispute in disputes:
            if isinstance(dispute, dict):
                issue = str(dispute.get("issue", "")).strip()
                points = dispute.get("points", [])
                if issue:
                    valid_points = [p for p in points if isinstance(p, str) and p.strip()]
                    valid_disputes.append({
                        "issue": issue,
                        "points": valid_points
                    })
        result["disputes"] = valid_disputes

        summary = result.get("summary", "")
        if not isinstance(summary, str) or not summary.strip():
            summary = self._regex_extract_summary(transcription)
        result["summary"] = str(summary).strip()

        return result

    def analyze_transcription(self, transcription: str) -> Dict[str, Any]:
        json_schema = self._get_json_schema_prompt()

        system_prompt = f"""你是一个专业的会议分析助手。请仔细阅读会议转录内容，提取会议的关键信息。

你必须严格按照以下 JSON Schema 输出结果，不要包含任何其他文字、解释或markdown格式，只输出纯JSON：

```json
{json_schema}
```

要求：
1. 仔细识别每一个决策、待办事项和争议点
2. 待办事项要提取负责人和截止日期，如果原文没有明确说明，填"未指定"
3. 争议点要记录不同的观点
4. 摘要是会议内容的高度概括，100-300字
5. 如果某些信息不存在，返回空数组或空字符串
6. 必须输出严格有效的JSON格式"""

        prompt = f"""请分析以下会议转录内容：

```
{transcription}
```

请严格按照 JSON Schema 输出分析结果。"""

        max_attempts = 3
        last_error = None

        for attempt in range(max_attempts):
            try:
                print(f"LLM analysis attempt {attempt + 1}/{max_attempts}")
                response = self._call_ollama(prompt, system_prompt)

                result = self._extract_json_robust(response)
                if result is not None:
                    result = self._validate_and_fix_result(result, transcription)
                    print(f"LLM analysis completed successfully on attempt {attempt + 1}")
                    return result
                else:
                    print(f"Attempt {attempt + 1}: Failed to extract JSON, retrying...")

            except Exception as e:
                last_error = str(e)
                print(f"Attempt {attempt + 1} failed: {e}")

        print(f"All {max_attempts} attempts failed, using regex fallback")
        fallback_result = {
            "decisions": self._regex_extract_decisions(transcription),
            "todos": self._regex_extract_todos(transcription),
            "disputes": self._regex_extract_disputes(transcription),
            "summary": self._regex_extract_summary(transcription)
        }

        print(f"Fallback extraction completed: {len(fallback_result['decisions'])} decisions, "
              f"{len(fallback_result['todos'])} todos, "
              f"{len(fallback_result['disputes'])} disputes")

        return fallback_result


llm_analyzer = LLMAnalyzer()
