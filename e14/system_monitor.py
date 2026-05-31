from textual.app import App, ComposeResult
from textual.widgets import Static, Header, Footer
from textual.containers import Horizontal, Vertical, Container, ScrollableContainer
from textual.reactive import reactive
from textual.css.query import NoMatches
from rich.text import Text
from monitor_data import SystemMonitorData
import asyncio
from collections import deque


class ASCIILineChart:
    @staticmethod
    def generate_chart(data: deque, width: int = 50, height: int = 6, color: str = "green") -> Text:
        if not data:
            return Text(" " * max(1, width))
        
        max_val = max(data) if max(data) > 0 else 100
        min_val = 0
        
        chart_lines = []
        char_set = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
        
        actual_width = min(len(data), max(1, width))
        
        for y in range(height - 1, -1, -1):
            line = Text()
            data_list = list(data)[-actual_width:]
            for i, value in enumerate(data_list):
                normalized = (value - min_val) / (max_val - min_val) if max_val != min_val else 0
                char_level = int(normalized * (len(char_set) - 1))
                
                threshold = y / (height - 1)
                if normalized >= threshold:
                    char = char_set[min(char_level, len(char_set) - 1)]
                    line.append(char, style=color)
                else:
                    line.append(" ")
            chart_lines.append(line)
        
        result = Text()
        for i, line in enumerate(chart_lines):
            result.append(line)
            if i < len(chart_lines) - 1:
                result.append("\n")
        
        return result


class CPUWidget(Static):
    data = reactive(None)
    
    def __init__(self, monitor_data: SystemMonitorData, **kwargs):
        super().__init__(**kwargs)
        self.monitor_data = monitor_data
        self.core_bars = []
    
    def compose(self) -> ComposeResult:
        core_count = self.monitor_data.get_core_count()
        self.core_bars = [Static("", id=f"core-{i}", classes="core-bar") for i in range(core_count)]
        
        yield Static("🔥 CPU Usage", classes="section-title")
        yield ScrollableContainer(*self.core_bars, id="cpu-cores-container", classes="cores-scroll")
        yield Static(id="cpu-chart-title", classes="chart-title")
        yield Static(id="cpu-chart", classes="chart")
    
    def watch_data(self, old_value, new_value):
        if new_value is None:
            return
        
        cpu_percents, cpu_history_avg = new_value
        
        for i, percent in enumerate(cpu_percents):
            if i < len(self.core_bars):
                color = self._get_color(percent)
                bar_text = Text(f"Core {i:2d}: ", style="white")
                bar_text.append(f"{percent:5.1f}% ", style=f"bold {color}")
                bar_text.append(self._create_bar(percent, color, max_width=15))
                self.core_bars[i].update(bar_text)
        
        try:
            chart_title = Text(f" CPU Average History (Last 30s) ", style="bold #00ff00 on #003300")
            self.query_one("#cpu-chart-title", Static).update(chart_title)
            
            chart_width = max(20, self.size.width - 8)
            chart = ASCIILineChart.generate_chart(cpu_history_avg, width=chart_width, height=5, color="#00ff00")
            self.query_one("#cpu-chart", Static).update(chart)
        except (NoMatches, Exception):
            pass
    
    def _create_bar(self, percent: float, color: str, max_width: int = 10) -> Text:
        bar_length = int(min(percent / 10, max_width))
        bar = Text()
        bar.append("█" * bar_length, style=color)
        bar.append("░" * max(0, max_width - bar_length), style="dim white")
        return bar
    
    def _get_color(self, percent: float) -> str:
        if percent < 50:
            return "#00ff00"
        elif percent < 80:
            return "#ffff00"
        else:
            return "#ff0000"


class MemoryWidget(Static):
    data = reactive(None)
    
    def __init__(self, monitor_data: SystemMonitorData, **kwargs):
        super().__init__(**kwargs)
        self.monitor_data = monitor_data
    
    def compose(self) -> ComposeResult:
        yield Static("🧠 Memory Usage", classes="section-title")
        yield Static(id="memory-bar", classes="memory-bar")
        yield Static(id="memory-info", classes="memory-info")
        yield Static(id="memory-chart-title", classes="chart-title")
        yield Static(id="memory-chart", classes="chart")
    
    def watch_data(self, old_value, new_value):
        if new_value is None:
            return
        
        mem_percent, mem_used, mem_total, mem_history = new_value
        
        color = self._get_color(mem_percent)
        bar_width = max(10, min(30, self.size.width - 20))
        mem_bar = Text()
        mem_bar.append(f"{mem_percent:.1f}% ", style=f"bold {color}")
        mem_bar.append(self._create_bar(mem_percent, color, max_width=bar_width))
        self.query_one("#memory-bar", Static).update(mem_bar)
        
        mem_info = Text(f"  Used: {mem_used:.2f} GB / {mem_total:.2f} GB", style="#88ccff")
        self.query_one("#memory-info", Static).update(mem_info)
        
        try:
            chart_title = Text(f" Memory History (Last 30s) ", style="bold #00aaff on #002244")
            self.query_one("#memory-chart-title", Static).update(chart_title)
            
            chart_width = max(20, self.size.width - 8)
            chart = ASCIILineChart.generate_chart(mem_history, width=chart_width, height=5, color="#00aaff")
            self.query_one("#memory-chart", Static).update(chart)
        except (NoMatches, Exception):
            pass
    
    def _create_bar(self, percent: float, color: str, max_width: int = 10) -> Text:
        bar_length = int(min(percent / 10, max_width))
        bar = Text()
        bar.append("█" * bar_length, style=color)
        bar.append("░" * max(0, max_width - bar_length), style="dim white")
        return bar
    
    def _get_color(self, percent: float) -> str:
        if percent < 50:
            return "#00aaff"
        elif percent < 80:
            return "#ffaa00"
        else:
            return "#ff0000"


class NetworkWidget(Static):
    data = reactive(None)
    
    def __init__(self, monitor_data: SystemMonitorData, **kwargs):
        super().__init__(**kwargs)
        self.monitor_data = monitor_data
    
    def compose(self) -> ComposeResult:
        yield Static("🌐 Network", classes="section-title")
        yield Static(id="network-sent", classes="network-stat")
        yield Static(id="network-recv", classes="network-stat")
        yield Static(id="network-chart-title", classes="chart-title")
        yield Static(id="network-chart", classes="chart")
    
    def watch_data(self, old_value, new_value):
        if new_value is None:
            return
        
        sent_speed, recv_speed, sent_history, recv_history = new_value
        
        sent_text = Text("  ↑ TX: ", style="white")
        sent_text.append(self.monitor_data.format_speed(sent_speed), style="bold #00ff88")
        self.query_one("#network-sent", Static).update(sent_text)
        
        recv_text = Text("  ↓ RX: ", style="white")
        recv_text.append(self.monitor_data.format_speed(recv_speed), style="bold #ff8800")
        self.query_one("#network-recv", Static).update(recv_text)
        
        try:
            chart_title = Text(f" Network History (Last 30s) ", style="bold #ff8800 on #331100")
            self.query_one("#network-chart-title", Static).update(chart_title)
            
            chart_width = max(20, self.size.width - 8)
            sent_chart = ASCIILineChart.generate_chart(sent_history, width=chart_width, height=3, color="#00ff88")
            recv_chart = ASCIILineChart.generate_chart(recv_history, width=chart_width, height=3, color="#ff8800")
            
            combined_chart = Text()
            combined_chart.append(Text("TX (↑): ", style="bold #00ff88"))
            combined_chart.append("\n")
            combined_chart.append(sent_chart)
            combined_chart.append("\n\n")
            combined_chart.append(Text("RX (↓): ", style="bold #ff8800"))
            combined_chart.append("\n")
            combined_chart.append(recv_chart)
            
            self.query_one("#network-chart", Static).update(combined_chart)
        except (NoMatches, Exception):
            pass


class ProcessList(Static):
    data = reactive(None)
    
    def __init__(self, monitor_data: SystemMonitorData, **kwargs):
        super().__init__(**kwargs)
        self.monitor_data = monitor_data
    
    def compose(self) -> ComposeResult:
        yield Static("📊 Top CPU Processes", classes="section-title")
        yield Static(id="process-header", classes="process-header")
        yield ScrollableContainer(id="process-container", classes="process-scroll")
    
    def watch_data(self, old_value, new_value):
        if new_value is None:
            return
        
        try:
            header = Text()
            header.append("  PID   ", style="bold #ffaa00")
            header.append("CPU%   ", style="bold #00ff88")
            header.append("Process Name", style="bold #ffffff")
            self.query_one("#process-header", Static).update(header)
            
            container = self.query_one("#process-container", ScrollableContainer)
            
            new_widgets = []
            for i, proc in enumerate(new_value):
                color = self._get_color(proc['cpu_percent'])
                line = Text()
                line.append(f"{proc['pid']:>6}  ", style="#cccccc")
                line.append(f"{proc['cpu_percent']:>5.1f}  ", style=f"bold {color}")
                
                name_width = max(10, self.size.width - 20)
                proc_name = proc['name'][:name_width]
                line.append(f"{proc_name}", style="#ffffff")
                
                new_widgets.append(Static(line, classes=f"process-row process-row-{i % 2}"))
            
            old_widgets = container.query(".process-row")
            for w in old_widgets:
                w.remove()
            
            container.mount(*new_widgets)
            
        except (NoMatches, Exception):
            pass
    
    def _get_color(self, percent: float) -> str:
        if percent < 20:
            return "#00ff00"
        elif percent < 50:
            return "#ffff00"
        else:
            return "#ff0000"


class SystemMonitorApp(App):
    CSS = """
    Screen {
        background: #0a0a0a;
        overflow: hidden;
    }
    
    Header {
        background: #1a1a2e;
        color: #00ff88;
        text-style: bold;
        dock: top;
        height: 1;
    }
    
    Footer {
        background: #1a1a2e;
        color: #888888;
        dock: bottom;
        height: 1;
    }
    
    ScrollableContainer {
        background: transparent;
        scrollbar-background: #1a1a2e;
        scrollbar-color: #3a3a5e;
        scrollbar-color-active: #5a5a8e;
        scrollbar-color-hover: #4a4a7e;
    }
    
    .section-title {
        color: #ffffff;
        text-style: bold;
        background: #1a1a2e;
        padding: 0 1;
        margin: 0 0 1 0;
        border: solid #333344;
        height: 1;
        min-height: 1;
    }
    
    #cpu-cores-container {
        height: 1fr;
        min-height: 3;
        max-height: 12;
        margin: 0 1;
    }
    
    .core-bar {
        height: 1;
        min-height: 1;
        margin: 0 0 0 0;
    }
    
    .memory-bar, .memory-info, .network-stat {
        height: 1;
        min-height: 1;
        margin: 0 0 0 1;
    }
    
    .chart-title {
        padding: 0 1;
        margin: 1 0 0 1;
        height: 1;
        min-height: 1;
    }
    
    .chart {
        padding: 0 2;
        margin: 0 0 1 0;
        min-height: 3;
    }
    
    .process-header {
        height: 1;
        min-height: 1;
        padding: 0 1;
        margin: 0 0 0 0;
        background: #1a1a2e;
    }
    
    .process-scroll {
        height: 1fr;
        min-height: 5;
        max-height: 12;
        margin: 0 1;
    }
    
    .process-row {
        height: 1;
        min-height: 1;
        padding: 0 1;
    }
    
    .process-row-0 {
        background: #0d0d1a;
    }
    
    .process-row-1 {
        background: #0a0a14;
    }
    
    Static {
        color: #cccccc;
    }
    
    #left-panel, #right-panel {
        height: 1fr;
        min-width: 25;
    }
    
    #left-panel {
        width: 1fr;
    }
    
    #right-panel {
        width: 1fr;
    }
    
    Horizontal {
        height: 1fr;
        min-height: 10;
    }
    
    @media (max-width: 70) {
        Horizontal {
            layout: vertical;
        }
        
        #left-panel, #right-panel {
            width: 1fr;
            height: auto;
            min-height: 5;
        }
        
        #cpu-cores-container {
            max-height: 6;
        }
    }
    """
    
    TITLE = "System Monitor"
    SUB_TITLE = "Press Ctrl+C to exit"
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.monitor_data = SystemMonitorData(history_size=30)
    
    def compose(self) -> ComposeResult:
        yield Header()
        
        with ScrollableContainer(id="main-scroll"):
            with Horizontal():
                with Vertical(id="left-panel"):
                    yield CPUWidget(self.monitor_data, id="cpu-widget")
                
                with Vertical(id="right-panel"):
                    yield MemoryWidget(self.monitor_data, id="memory-widget")
                    yield NetworkWidget(self.monitor_data, id="network-widget")
            
            yield ProcessList(self.monitor_data, id="process-list")
        
        yield Footer()
    
    async def on_mount(self) -> None:
        self.update_task = asyncio.create_task(self.update_data())
    
    async def update_data(self) -> None:
        while True:
            self.monitor_data.update_history()
            
            try:
                cpu_widget = self.query_one("#cpu-widget", CPUWidget)
                cpu_widget.data = (
                    self.monitor_data.get_cpu_percent(),
                    self.monitor_data.get_cpu_history_avg()
                )
            except NoMatches:
                pass
            
            try:
                mem_widget = self.query_one("#memory-widget", MemoryWidget)
                mem_percent, mem_used, mem_total = self.monitor_data.get_memory_info()
                mem_widget.data = (
                    mem_percent,
                    mem_used,
                    mem_total,
                    self.monitor_data.memory_history
                )
            except NoMatches:
                pass
            
            try:
                net_widget = self.query_one("#network-widget", NetworkWidget)
                sent_speed, recv_speed = self.monitor_data.get_network_speed()
                net_widget.data = (
                    sent_speed,
                    recv_speed,
                    self.monitor_data.network_sent_history,
                    self.monitor_data.network_recv_history
                )
            except NoMatches:
                pass
            
            try:
                process_widget = self.query_one("#process-list", ProcessList)
                process_widget.data = self.monitor_data.get_top_processes(limit=10)
            except NoMatches:
                pass
            
            await asyncio.sleep(1)


if __name__ == "__main__":
    app = SystemMonitorApp()
    app.run()
