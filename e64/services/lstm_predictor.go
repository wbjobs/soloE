package services

import (
	"context"
	"math"
	"sync"
	"time"

	"gonum.org/v1/gonum/mat"
	"anomaly-detection-api/models"
	"anomaly-detection-api/repository"
)

type LSTMPredictor struct {
	models       map[string]*LSTMModel
	modelMutex   sync.RWMutex
	historySize  int
	predictSteps int
}

type LSTMModel struct {
	Wi, Ui, bi *mat.Dense
	Wf, Uf, bf *mat.Dense
	Wo, Uo, bo *mat.Dense
	Wc, Uc, bc *mat.Dense
	Wy, by     *mat.Dense
	hSize      int
	xSize      int
	lastH, lastC *mat.Dense
	lastUpdate time.Time
}

func NewLSTMPredictor(historySize, predictSteps int) *LSTMPredictor {
	return &LSTMPredictor{
		models:       make(map[string]*LSTMModel),
		historySize:  historySize,
		predictSteps: predictSteps,
	}
}

func NewLSTMModel(inputSize, hiddenSize int) *LSTMModel {
	m := &LSTMModel{
		hSize: hiddenSize,
		xSize: inputSize,
	}

	m.Wi = mat.NewDense(hiddenSize, inputSize, nil)
	m.Ui = mat.NewDense(hiddenSize, hiddenSize, nil)
	m.bi = mat.NewDense(hiddenSize, 1, nil)

	m.Wf = mat.NewDense(hiddenSize, inputSize, nil)
	m.Uf = mat.NewDense(hiddenSize, hiddenSize, nil)
	m.bf = mat.NewDense(hiddenSize, 1, nil)

	m.Wo = mat.NewDense(hiddenSize, inputSize, nil)
	m.Uo = mat.NewDense(hiddenSize, hiddenSize, nil)
	m.bo = mat.NewDense(hiddenSize, 1, nil)

	m.Wc = mat.NewDense(hiddenSize, inputSize, nil)
	m.Uc = mat.NewDense(hiddenSize, hiddenSize, nil)
	m.bc = mat.NewDense(hiddenSize, 1, nil)

	m.Wy = mat.NewDense(inputSize, hiddenSize, nil)
	m.by = mat.NewDense(inputSize, 1, nil)

	m.initializeWeights()

	m.lastH = mat.NewDense(hiddenSize, 1, nil)
	m.lastC = mat.NewDense(hiddenSize, 1, nil)

	return m
}

func (m *LSTMModel) initializeWeights() {
	scale := 1.0 / math.Sqrt(float64(m.hSize))

	for _, w := range []*mat.Dense{m.Wi, m.Ui, m.Wf, m.Uf, m.Wo, m.Uo, m.Wc, m.Uc, m.Wy} {
		r, c := w.Dims()
		for i := 0; i < r; i++ {
			for j := 0; j < c; j++ {
				w.Set(i, j, (randFloat()-0.5)*2*scale)
			}
		}
	}
}

func randFloat() float64 {
	return float64(uint32(time.Now().UnixNano())%10000) / 10000.0
}

func (m *LSTMModel) sigmoid(x float64) float64 {
	return 1.0 / (1.0 + math.Exp(-x))
}

func (m *LSTMModel) tanh(x float64) float64 {
	return math.Tanh(x)
}

func (m *LSTMModel) forward(x *mat.Dense) (*mat.Dense, *mat.Dense) {
	hPrev := m.lastH
	cPrev := m.lastC

	it := m.gate(x, hPrev, m.Wi, m.Ui, m.bi, m.sigmoid)
	ft := m.gate(x, hPrev, m.Wf, m.Uf, m.bf, m.sigmoid)
	ot := m.gate(x, hPrev, m.Wo, m.Uo, m.bo, m.sigmoid)
	ct := m.gate(x, hPrev, m.Wc, m.Uc, m.bc, m.tanh)

	cNew := &mat.Dense{}
	cNew.MulElem(ft, cPrev)
	cTemp := &mat.Dense{}
	cTemp.MulElem(it, ct)
	cNew.Add(cNew, cTemp)

	hNew := &mat.Dense{}
	hNew.Apply(func(i, j int, v float64) float64 { return m.tanh(v) }, cNew)
	hNew.MulElem(hNew, ot)

	y := &mat.Dense{}
	y.Mul(m.Wy, hNew)
	y.Add(y, m.by)

	m.lastH = hNew
	m.lastC = cNew

	return y, hNew
}

func (m *LSTMModel) gate(x, h, w, u, b *mat.Dense, activation func(float64) float64) *mat.Dense {
	wx := &mat.Dense{}
	wx.Mul(w, x)

	uh := &mat.Dense{}
	uh.Mul(u, h)

	result := &mat.Dense{}
	result.Add(wx, uh)
	result.Add(result, b)
	result.Apply(func(i, j int, v float64) float64 { return activation(v) }, result)

	return result
}

func (p *LSTMPredictor) getOrCreateModel(tenantID, deviceID string) *LSTMModel {
	key := tenantID + ":" + deviceID

	p.modelMutex.RLock()
	model, exists := p.models[key]
	p.modelMutex.RUnlock()

	if exists {
		return model
	}

	p.modelMutex.Lock()
	defer p.modelMutex.Unlock()

	if model, exists = p.models[key]; exists {
		return model
	}

	model = NewLSTMModel(3, 32)
	p.models[key] = model
	return model
}

func (p *LSTMPredictor) Predict(ctx context.Context, tenantID, deviceID string) (*PredictionResult, error) {
	historyData, err := repository.GetRecentSensorData(ctx, tenantID, deviceID, p.historySize)
	if err != nil {
		return nil, err
	}

	if len(historyData) < p.historySize {
		return &PredictionResult{
			HasPrediction: false,
			Message:       "Insufficient history data",
		}, nil
	}

	model := p.getOrCreateModel(tenantID, deviceID)

	sequence := make([][]float64, len(historyData))
	for i, d := range historyData {
		sequence[i] = []float64{d.Temperature, d.Vibration, d.Current}
	}

	normalized, mean, std := normalizeSequence(sequence)

	predictions := make([][]float64, p.predictSteps)
	current := normalized[len(normalized)-1]

	for step := 0; step < p.predictSteps; step++ {
		x := mat.NewDense(3, 1, current)
		y, _ := model.forward(x)
		pred := make([]float64, 3)
		for i := 0; i < 3; i++ {
			pred[i] = y.At(i, 0)*std[i] + mean[i]
		}
		predictions[step] = pred
		current = y.RawMatrix().Data
	}

	anomalyProb := p.calculateAnomalyProbability(predictions, sequence, mean, std)

	result := &PredictionResult{
		HasPrediction:    true,
		TenantID:         tenantID,
		DeviceID:         deviceID,
		PredictionTime:   time.Now(),
		PredictedValues:  predictions,
		AnomalyProbability: anomalyProb,
		WillAnomaly:      anomalyProb > 0.7,
		TimeToAnomaly:    p.estimateTimeToAnomaly(predictions, sequence),
	}

	return result, nil
}

func normalizeSequence(seq [][]float64) ([][]float64, []float64, []float64) {
	n := len(seq)
	if n == 0 {
		return seq, nil, nil
	}

	features := len(seq[0])
	mean := make([]float64, features)
	std := make([]float64, features)

	for f := 0; f < features; f++ {
		sum := 0.0
		for i := 0; i < n; i++ {
			sum += seq[i][f]
		}
		mean[f] = sum / float64(n)

		variance := 0.0
		for i := 0; i < n; i++ {
			diff := seq[i][f] - mean[f]
			variance += diff * diff
		}
		std[f] = math.Sqrt(variance / float64(n))
		if std[f] == 0 {
			std[f] = 1
		}
	}

	normalized := make([][]float64, n)
	for i := 0; i < n; i++ {
		normalized[i] = make([]float64, features)
		for f := 0; f < features; f++ {
			normalized[i][f] = (seq[i][f] - mean[f]) / std[f]
		}
	}

	return normalized, mean, std
}

func (p *LSTMPredictor) calculateAnomalyProbability(predictions [][]float64, history [][]float64, mean, std []float64) float64 {
	if len(predictions) == 0 {
		return 0
	}

	features := len(predictions[0])
	maxDeviation := 0.0

	for _, pred := range predictions {
		for f := 0; f < features; f++ {
			if std[f] > 0 {
				deviation := math.Abs(pred[f] - mean[f]) / std[f]
				if deviation > maxDeviation {
					maxDeviation = deviation
				}
			}
		}
	}

	probability := 1.0 - math.Exp(-maxDeviation/2.0)
	return math.Min(1.0, probability)
}

func (p *LSTMPredictor) estimateTimeToAnomaly(predictions [][]float64, history [][]float64) time.Duration {
	if len(predictions) < 2 {
		return 30 * time.Second
	}

	threshold := 3.0
	mean := make([]float64, 3)
	std := make([]float64, 3)

	for f := 0; f < 3; f++ {
		sum := 0.0
		for _, h := range history {
			sum += h[f]
		}
		mean[f] = sum / float64(len(history))

		variance := 0.0
		for _, h := range history {
			diff := h[f] - mean[f]
			variance += diff * diff
		}
		std[f] = math.Sqrt(variance / float64(len(history)))
	}

	for step, pred := range predictions {
		for f := 0; f < 3; f++ {
			if std[f] > 0 {
				deviation := math.Abs(pred[f] - mean[f]) / std[f]
				if deviation > threshold {
					return time.Duration(step+1) * 5 * time.Second
				}
			}
		}
	}

	return 30 * time.Second
}

func (p *LSTMPredictor) Train(ctx context.Context, tenantID, deviceID string, sequences [][][]float64) error {
	model := p.getOrCreateModel(tenantID, deviceID)

	for _, seq := range sequences {
		normalized, _, _ := normalizeSequence(seq)
		for _, x := range normalized {
			xMat := mat.NewDense(3, 1, x)
			model.forward(xMat)
		}
	}

	model.lastUpdate = time.Now()
	return nil
}

type PredictionResult struct {
	HasPrediction     bool        `json:"has_prediction"`
	Message           string      `json:"message,omitempty"`
	TenantID          string      `json:"tenant_id"`
	DeviceID          string      `json:"device_id"`
	PredictionTime    time.Time   `json:"prediction_time"`
	PredictedValues   [][]float64 `json:"predicted_values"`
	AnomalyProbability float64    `json:"anomaly_probability"`
	WillAnomaly       bool        `json:"will_anomaly"`
	TimeToAnomaly     time.Duration `json:"time_to_anomaly"`
}
