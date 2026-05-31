from dataclasses import dataclass, field
from enum import Enum
from typing import List, Dict, Any, Optional


class Severity(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

    @classmethod
    def from_score(cls, score: int) -> 'Severity':
        if score >= 80:
            return cls.CRITICAL
        elif score >= 60:
            return cls.HIGH
        elif score >= 40:
            return cls.MEDIUM
        else:
            return cls.LOW


@dataclass
class CodeSmell:
    smell_type: str
    severity: Severity
    severity_score: int
    file_path: str
    start_line: int
    end_line: int
    description: str
    code_snippet: str
    refactor_suggestion: Optional[str] = None
    refactor_example: Optional[str] = None


@dataclass
class AnalysisResult:
    file_path: str
    language: str
    total_lines: int
    smells: List[CodeSmell] = field(default_factory=list)
    total_smells: int = 0
    avg_severity: float = 0.0

    def calculate_stats(self):
        self.total_smells = len(self.smells)
        if self.smells:
            self.avg_severity = sum(s.severity_score for s in self.smells) / len(self.smells)


@dataclass
class AnalysisReport:
    files_analyzed: int
    total_smells: int
    results: List[AnalysisResult] = field(default_factory=list)
    smells_by_type: Dict[str, int] = field(default_factory=dict)
    overall_score: float = 0.0

    def calculate_overall(self):
        self.files_analyzed = len(self.results)
        self.total_smells = sum(r.total_smells for r in self.results)
        
        for result in self.results:
            for smell in result.smells:
                self.smells_by_type[smell.smell_type] = self.smells_by_type.get(smell.smell_type, 0) + 1
        
        if self.results:
            total_avg = sum(r.avg_severity for r in self.results if r.smells)
            count = sum(1 for r in self.results if r.smells)
            if count > 0:
                self.overall_score = total_avg / count
