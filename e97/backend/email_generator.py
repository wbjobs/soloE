from typing import Dict, Any, List, Optional
from datetime import datetime


class EmailGenerator:
    def __init__(self):
        self.email_templates = {
            "formal": {
                "subject": "会议纪要 - {title}",
                "greeting": "各位同事：",
                "intro": "现将本次会议的主要内容和决议通知如下：",
                "decisions_title": "一、会议决议",
                "todos_title": "二、待办事项",
                "disputes_title": "三、待跟进问题",
                "summary_title": "四、会议摘要",
                "closing": "如有任何疑问，请随时沟通。",
                "signature": "此致\n敬礼\n\n会议记录员\n{date}"
            },
            "simple": {
                "subject": "【会议纪要】{title}",
                "greeting": "Hi all,",
                "intro": "以下是本次会议的要点总结：",
                "decisions_title": "✅ 决议",
                "todos_title": "📋 待办",
                "disputes_title": "⚠️ 待跟进",
                "summary_title": "📝 摘要",
                "closing": "Thanks!",
                "signature": "{date}"
            },
            "detailed": {
                "subject": "详细会议纪要 - {title}",
                "greeting": "尊敬的参会者：",
                "intro": "感谢您参加本次会议。以下是会议的详细记录：",
                "decisions_title": "【会议决议】",
                "todos_title": "【待办事项分配】",
                "disputes_title": "【待讨论/确认事项】",
                "summary_title": "【会议内容摘要】",
                "closing": "请各位确认相关事项，如有异议请在3个工作日内反馈。",
                "signature": "会议组织者\n{date}"
            }
        }

    def generate_email(
        self,
        meeting_data: Dict[str, Any],
        template: str = "formal",
        recipients: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        if template not in self.email_templates:
            template = "formal"

        tpl = self.email_templates[template]
        title = meeting_data.get("title", "会议")
        date_str = datetime.now().strftime("%Y年%m月%d日")

        subject = tpl["subject"].format(title=title)

        body_parts = [tpl["greeting"], "", tpl["intro"], ""]

        decisions = meeting_data.get("decisions", [])
        if decisions:
            body_parts.append(tpl["decisions_title"])
            for i, decision in enumerate(decisions, 1):
                body_parts.append(f"{i}. {decision}")
            body_parts.append("")

        todos = meeting_data.get("todos", [])
        if todos:
            body_parts.append(tpl["todos_title"])
            for i, todo in enumerate(todos, 1):
                task = todo.get("task", "")
                assignee = todo.get("assignee", "未指定")
                deadline = todo.get("deadline", "未指定")
                body_parts.append(f"{i}. {task}")
                body_parts.append(f"   负责人：{assignee}")
                body_parts.append(f"   截止：{deadline}")
            body_parts.append("")

        disputes = meeting_data.get("disputes", [])
        if disputes:
            body_parts.append(tpl["disputes_title"])
            for i, dispute in enumerate(disputes, 1):
                issue = dispute.get("issue", "")
                points = dispute.get("points", [])
                body_parts.append(f"{i}. {issue}")
                for point in points:
                    body_parts.append(f"   - {point}")
            body_parts.append("")

        summary = meeting_data.get("summary", "")
        if summary:
            body_parts.append(tpl["summary_title"])
            body_parts.append(summary)
            body_parts.append("")

        speakers = meeting_data.get("speakers", [])
        if speakers:
            body_parts.append("【参会人员】")
            body_parts.append(", ".join(speakers))
            body_parts.append("")

        body_parts.append(tpl["closing"])
        body_parts.append("")
        body_parts.append(tpl["signature"].format(date=date_str))

        body = "\n".join(body_parts)

        email = {
            "subject": subject,
            "body": body,
            "recipients": recipients or [],
            "template": template
        }

        return email

    def generate_markdown_email(
        self,
        meeting_data: Dict[str, Any],
        template: str = "formal"
    ) -> str:
        email = self.generate_email(meeting_data, template)
        
        md_parts = [
            f"**主题**: {email['subject']}",
            "",
            "---",
            "",
            email["body"]
        ]
        
        return "\n".join(md_parts)

    def get_available_templates(self) -> List[str]:
        return list(self.email_templates.keys())


email_generator = EmailGenerator()
