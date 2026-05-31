package diffdetector

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"html/template"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/nfs-proxy/internal/nfs"
	"github.com/nfs-proxy/internal/rpc"
)

type DiffDetector struct {
	realServerAddr  string
	mockServerAddr  string
	timeout         time.Duration
	config          DiffConfig
	stats           *DiffStats
	dumpDir         string
}

type DiffConfig struct {
	RealServerAddr    string
	MockServerAddr    string
	Timeout           time.Duration
	DiffThreshold     float64
	EnableXDRDump     bool
	MaxDumps          int
	TrendWindowSize   int
}

type DiffStats struct {
	mu                sync.Mutex
	TotalRequests     uint64
	MatchedResponses  uint64
	DiffResponses     uint64
	RealErrors        uint64
	MockErrors        uint64
	ProcedureDiffs    map[string]*ProcedureDiffStat
	TrendData         []TrendPoint
	StartTime         time.Duration
	AlertTriggered    bool
	AlertMessage      string
	dumpCount         int
}

type ProcedureDiffStat struct {
	Total     uint64
	Matched   uint64
	Diff      uint64
}

type TrendPoint struct {
	Timestamp     time.Time
	TotalRequests uint64
	DiffCount     uint64
	DiffRate      float64
}

type DiffResult struct {
	Xid              uint32
	Procedure        string
	RealStatus       uint32
	RealStatusName   string
	MockStatus       uint32
	MockStatusName   string
	IsDiff           bool
	RealResponse     []byte
	MockResponse     []byte
	RequestData      []byte
	Error            string
}

type XDRDump struct {
	Timestamp     time.Time
	Xid           uint32
	Procedure     string
	RealStatus    uint32
	MockStatus    uint32
	RequestHex    string
	RealResponseHex string
	MockResponseHex string
}

func NewDiffDetector(cfg DiffConfig) *DiffDetector {
	if cfg.Timeout == 0 {
		cfg.Timeout = 30 * time.Second
	}
	if cfg.DiffThreshold == 0 {
		cfg.DiffThreshold = 0.1
	}
	if cfg.MaxDumps == 0 {
		cfg.MaxDumps = 100
	}
	if cfg.TrendWindowSize == 0 {
		cfg.TrendWindowSize = 100
	}

	return &DiffDetector{
		realServerAddr: cfg.RealServerAddr,
		mockServerAddr: cfg.MockServerAddr,
		timeout:        cfg.Timeout,
		config:         cfg,
		stats: &DiffStats{
			ProcedureDiffs: make(map[string]*ProcedureDiffStat),
			TrendData:      make([]TrendPoint, 0),
			StartTime:      0,
		},
	}
}

func (d *DiffDetector) SetDumpDir(dir string) {
	d.dumpDir = dir
	if dir != "" {
		os.MkdirAll(dir, 0755)
	}
}

func (d *DiffDetector) Detect(msg *rpc.RPCMsg) *DiffResult {
	result := &DiffResult{
		Xid: msg.Xid,
	}

	if call, ok := msg.Body.(*rpc.RPCMsgCall); ok {
		result.Procedure = nfs.ProcedureName(call.Program, call.Version, call.Procedure)
	}

	msgData, err := rpc.WriteRPCMessageToBytes(msg)
	if err != nil {
		result.Error = fmt.Sprintf("failed to serialize message: %v", err)
		return result
	}
	result.RequestData = msgData

	var wg sync.WaitGroup
	var realResp *rpc.RPCMsg
	var mockResp *rpc.RPCMsg
	var realErr, mockErr error

	wg.Add(2)
	go func() {
		defer wg.Done()
		realResp, realErr = d.sendRequest(d.realServerAddr, msgData)
	}()
	go func() {
		defer wg.Done()
		mockResp, mockErr = d.sendRequest(d.mockServerAddr, msgData)
	}()
	wg.Wait()

	if realErr != nil {
		d.stats.mu.Lock()
		d.stats.RealErrors++
		d.stats.mu.Unlock()
		result.Error = fmt.Sprintf("real server error: %v", realErr)
		return result
	}

	if mockErr != nil {
		d.stats.mu.Lock()
		d.stats.MockErrors++
		d.stats.mu.Unlock()
		result.Error = fmt.Sprintf("mock server error: %v", mockErr)
		return result
	}

	realStatus := extractStatus(realResp)
	mockStatus := extractStatus(mockResp)

	result.RealStatus = realStatus
	result.RealStatusName = nfs.StatusName(realStatus)
	result.MockStatus = mockStatus
	result.MockStatusName = nfs.StatusName(mockStatus)
	result.IsDiff = realStatus != mockStatus

	result.RealResponse, _ = rpc.WriteRPCMessageToBytes(realResp)
	result.MockResponse, _ = rpc.WriteRPCMessageToBytes(mockResp)

	d.updateStats(result)

	if result.IsDiff && d.config.EnableXDRDump {
		d.saveXDRDump(result)
	}

	return result
}

func (d *DiffDetector) sendRequest(addr string, msgData []byte) (*rpc.RPCMsg, error) {
	conn, err := net.DialTimeout("tcp", addr, d.timeout)
	if err != nil {
		return nil, fmt.Errorf("connection failed: %w", err)
	}
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(d.timeout))

	if _, err := conn.Write(msgData); err != nil {
		return nil, fmt.Errorf("send failed: %w", err)
	}

	buf := make([]byte, 1024*1024)
	n, err := conn.Read(buf)
	if err != nil {
		return nil, fmt.Errorf("read failed: %w", err)
	}

	resp, err := rpc.ReadRPCMessageFromBytes(buf[:n])
	if err != nil {
		return nil, fmt.Errorf("parse failed: %w", err)
	}

	return resp, nil
}

func extractStatus(msg *rpc.RPCMsg) uint32 {
	if reply, ok := msg.Body.(*rpc.RPCMsgReply); ok {
		if accepted, ok := reply.Body.(*rpc.AcceptedReply); ok {
			if accepted.AcceptStatus != rpc.AcceptStatusSuccess {
				return accepted.AcceptStatus + 10000
			}
			if len(accepted.Data) >= 4 {
				return binary.BigEndian.Uint32(accepted.Data[0:4])
			}
		}
	}
	return 0xFFFFFFFF
}

func (d *DiffDetector) updateStats(result *DiffResult) {
	d.stats.mu.Lock()
	defer d.stats.mu.Unlock()

	d.stats.TotalRequests++
	if result.IsDiff {
		d.stats.DiffResponses++
	} else {
		d.stats.MatchedResponses++
	}

	if ps, ok := d.stats.ProcedureDiffs[result.Procedure]; ok {
		ps.Total++
		if result.IsDiff {
			ps.Diff++
		} else {
			ps.Matched++
		}
	} else {
		ps = &ProcedureDiffStat{Total: 1}
		if result.IsDiff {
			ps.Diff = 1
		} else {
			ps.Matched = 1
		}
		d.stats.ProcedureDiffs[result.Procedure] = ps
	}

	if d.stats.TotalRequests%uint64(d.config.TrendWindowSize) == 0 {
		diffRate := float64(d.stats.DiffResponses) / float64(d.stats.TotalRequests)
		d.stats.TrendData = append(d.stats.TrendData, TrendPoint{
			Timestamp:     time.Now(),
			TotalRequests: d.stats.TotalRequests,
			DiffCount:     d.stats.DiffResponses,
			DiffRate:      diffRate,
		})

		if diffRate > d.config.DiffThreshold && !d.stats.AlertTriggered {
			d.stats.AlertTriggered = true
			d.stats.AlertMessage = fmt.Sprintf("ALERT: Difference rate %.2f%% exceeds threshold %.2f%%",
				diffRate*100, d.config.DiffThreshold*100)
		}
	}
}

func (d *DiffDetector) saveXDRDump(result *DiffResult) {
	d.stats.mu.Lock()
	defer d.stats.mu.Unlock()

	if d.dumpDir == "" || d.stats.dumpCount >= d.config.MaxDumps {
		return
	}

	dump := XDRDump{
		Timestamp:       time.Now(),
		Xid:             result.Xid,
		Procedure:       result.Procedure,
		RealStatus:      result.RealStatus,
		MockStatus:      result.MockStatus,
		RequestHex:      hex.EncodeToString(result.RequestData),
		RealResponseHex: hex.EncodeToString(result.RealResponse),
		MockResponseHex: hex.EncodeToString(result.MockResponse),
	}

	filename := filepath.Join(d.dumpDir, fmt.Sprintf("diff_%d_%s_%d.json",
		dump.Timestamp.UnixNano(), dump.Procedure, dump.Xid))

	data, _ := os.ReadFile(filename)
	_ = data
	if err := os.WriteFile(filename, []byte(fmt.Sprintf(`{
  "timestamp": "%s",
  "xid": %d,
  "procedure": "%s",
  "real_status": %d,
  "real_status_name": "%s",
  "mock_status": %d,
  "mock_status_name": "%s",
  "request_hex": "%s",
  "real_response_hex": "%s",
  "mock_response_hex": "%s"
}
`, dump.Timestamp.Format(time.RFC3339Nano),
		dump.Xid, dump.Procedure,
		dump.RealStatus, nfs.StatusName(dump.RealStatus),
		dump.MockStatus, nfs.StatusName(dump.MockStatus),
		dump.RequestHex, dump.RealResponseHex, dump.MockResponseHex)), 0644); err == nil {
		d.stats.dumpCount++
	}
}

func (d *DiffDetector) GetStats() *DiffStats {
	d.stats.mu.Lock()
	defer d.stats.mu.Unlock()

	stats := &DiffStats{
		TotalRequests:    d.stats.TotalRequests,
		MatchedResponses: d.stats.MatchedResponses,
		DiffResponses:    d.stats.DiffResponses,
		RealErrors:       d.stats.RealErrors,
		MockErrors:       d.stats.MockErrors,
		ProcedureDiffs:   make(map[string]*ProcedureDiffStat),
		TrendData:        make([]TrendPoint, len(d.stats.TrendData)),
		AlertTriggered:   d.stats.AlertTriggered,
		AlertMessage:     d.stats.AlertMessage,
	}

	for k, v := range d.stats.ProcedureDiffs {
		stats.ProcedureDiffs[k] = &ProcedureDiffStat{
			Total:   v.Total,
			Matched: v.Matched,
			Diff:    v.Diff,
		}
	}
	copy(stats.TrendData, d.stats.TrendData)

	return stats
}

func (s *DiffStats) Print() {
	s.mu.Lock()
	defer s.mu.Unlock()

	fmt.Println("=== Semantic Difference Detection Statistics ===")
	fmt.Printf("Total Requests:      %d\n", s.TotalRequests)
	fmt.Printf("Matched Responses:   %d (%.2f%%)\n", s.MatchedResponses,
		float64(s.MatchedResponses)/float64(s.TotalRequests)*100)
	fmt.Printf("Different Responses: %d (%.2f%%)\n", s.DiffResponses,
		float64(s.DiffResponses)/float64(s.TotalRequests)*100)
	fmt.Printf("Real Server Errors:  %d\n", s.RealErrors)
	fmt.Printf("Mock Server Errors:  %d\n", s.MockErrors)

	if s.AlertTriggered {
		fmt.Printf("\n⚠️  ALERT: %s\n", s.AlertMessage)
	}

	fmt.Println("\nProcedure Breakdown:")
	fmt.Printf("  %-20s %8s %8s %8s %8s\n",
		"Procedure", "Total", "Matched", "Diff", "Diff%")
	for proc, ps := range s.ProcedureDiffs {
		diffPct := float64(ps.Diff) / float64(ps.Total) * 100
		fmt.Printf("  %-20s %8d %8d %8d %7.2f%%\n",
			proc, ps.Total, ps.Matched, ps.Diff, diffPct)
	}
	fmt.Println("=================================================")
}

func (s *DiffStats) GenerateHTMLReport(outputFile string) error {
	const htmlTemplate = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NFS 语义差异检测报告</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 20px; }
        .container { max-width: 1400px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 20px; }
        .header h1 { font-size: 28px; margin-bottom: 10px; }
        .alert { background: #ff6b6b; color: white; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-weight: bold; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
        .stat-card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
        .stat-card .label { color: #666; font-size: 14px; margin-bottom: 8px; }
        .stat-card .value { font-size: 32px; font-weight: bold; color: #333; }
        .stat-card .sub { font-size: 12px; color: #999; margin-top: 5px; }
        .chart-container { background: white; padding: 25px; border-radius: 10px; margin-bottom: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
        .chart-container h2 { margin-bottom: 20px; color: #333; font-size: 20px; }
        table { width: 100%; border-collapse: collapse; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
        th, td { padding: 15px; text-align: left; border-bottom: 1px solid #eee; }
        th { background: #f8f9fa; font-weight: 600; color: #333; }
        tr:hover { background: #f8f9fa; }
        .diff-high { color: #e74c3c; font-weight: bold; }
        .diff-low { color: #27ae60; }
        .generated { text-align: center; color: #999; padding: 20px; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 NFS 语义差异检测报告</h1>
            <p>生成时间: {{.GeneratedAt}}</p>
        </div>

        {{if .AlertTriggered}}
        <div class="alert">
            ⚠️ {{.AlertMessage}}
        </div>
        {{end}}

        <div class="stats-grid">
            <div class="stat-card">
                <div class="label">总请求数</div>
                <div class="value">{{.TotalRequests}}</div>
            </div>
            <div class="stat-card">
                <div class="label">匹配响应</div>
                <div class="value" style="color: #27ae60;">{{.MatchedResponses}}</div>
                <div class="sub">{{.MatchedPercent}}%</div>
            </div>
            <div class="stat-card">
                <div class="label">差异响应</div>
                <div class="value" style="color: #e74c3c;">{{.DiffResponses}}</div>
                <div class="sub">{{.DiffPercent}}%</div>
            </div>
            <div class="stat-card">
                <div class="label">真实服务器错误</div>
                <div class="value" style="color: #f39c12;">{{.RealErrors}}</div>
            </div>
            <div class="stat-card">
                <div class="label">Mock服务器错误</div>
                <div class="value" style="color: #f39c12;">{{.MockErrors}}</div>
            </div>
        </div>

        <div class="chart-container">
            <h2>📈 差异趋势图</h2>
            <canvas id="trendChart" height="100"></canvas>
        </div>

        <div class="chart-container">
            <h2>📊 各过程差异统计</h2>
            <table>
                <thead>
                    <tr>
                        <th>过程</th>
                        <th>总数</th>
                        <th>匹配</th>
                        <th>差异</th>
                        <th>差异率</th>
                    </tr>
                </thead>
                <tbody>
                    {{range .ProcedureStats}}
                    <tr>
                        <td>{{.Name}}</td>
                        <td>{{.Total}}</td>
                        <td>{{.Matched}}</td>
                        <td>{{.Diff}}</td>
                        <td class="{{if gt .DiffPct 10}}diff-high{{else}}diff-low{{end}}">{{.DiffPct}}%</td>
                    </tr>
                    {{end}}
                </tbody>
            </table>
        </div>

        <div class="generated">
            报告由 NFS Proxy 语义差异检测模块自动生成
        </div>
    </div>

    <script>
        const ctx = document.getElementById('trendChart').getContext('2d');
        const trendData = {{.TrendJSON}};
        
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: trendData.labels,
                datasets: [{
                    label: '差异率 (%)',
                    data: trendData.values,
                    borderColor: 'rgb(231, 76, 60)',
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: true }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            callback: function(value) {
                                return value + '%';
                            }
                        }
                    }
                }
            }
        });
    </script>
</body>
</html>`

	type TemplateData struct {
		GeneratedAt     string
		AlertTriggered  bool
		AlertMessage    string
		TotalRequests   uint64
		MatchedResponses uint64
		DiffResponses   uint64
		RealErrors      uint64
		MockErrors      uint64
		MatchedPercent  string
		DiffPercent     string
		TrendJSON       template.JS
		ProcedureStats  []struct {
			Name     string
			Total    uint64
			Matched  uint64
			Diff     uint64
			DiffPct  float64
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	var matchedPct, diffPct float64
	if s.TotalRequests > 0 {
		matchedPct = float64(s.MatchedResponses) / float64(s.TotalRequests) * 100
		diffPct = float64(s.DiffResponses) / float64(s.TotalRequests) * 100
	}

	labels := make([]string, 0, len(s.TrendData))
	values := make([]float64, 0, len(s.TrendData))
	for _, tp := range s.TrendData {
		labels = append(labels, tp.Timestamp.Format("15:04:05"))
		values = append(values, tp.DiffRate*100)
	}

	trendJSON := fmt.Sprintf(`{"labels": %q, "values": %v}`, labels, values)

	procStats := make([]struct {
		Name     string
		Total    uint64
		Matched  uint64
		Diff     uint64
		DiffPct  float64
	}, 0, len(s.ProcedureDiffs))

	for name, ps := range s.ProcedureDiffs {
		pct := float64(ps.Diff) / float64(ps.Total) * 100
		procStats = append(procStats, struct {
			Name     string
			Total    uint64
			Matched  uint64
			Diff     uint64
			DiffPct  float64
		}{name, ps.Total, ps.Matched, ps.Diff, pct})
	}

	data := TemplateData{
		GeneratedAt:      time.Now().Format(time.RFC3339),
		AlertTriggered:   s.AlertTriggered,
		AlertMessage:     s.AlertMessage,
		TotalRequests:    s.TotalRequests,
		MatchedResponses: s.MatchedResponses,
		DiffResponses:    s.DiffResponses,
		RealErrors:       s.RealErrors,
		MockErrors:       s.MockErrors,
		MatchedPercent:   fmt.Sprintf("%.2f", matchedPct),
		DiffPercent:      fmt.Sprintf("%.2f", diffPct),
		TrendJSON:        template.JS(trendJSON),
		ProcedureStats:   procStats,
	}

	tmpl, err := template.New("report").Parse(htmlTemplate)
	if err != nil {
		return fmt.Errorf("failed to parse template: %w", err)
	}

	f, err := os.Create(outputFile)
	if err != nil {
		return fmt.Errorf("failed to create output file: %w", err)
	}
	defer f.Close()

	return tmpl.Execute(f, data)
}
