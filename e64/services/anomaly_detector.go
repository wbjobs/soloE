package services

import (
	"math"
	"sort"

	"gonum.org/v1/gonum/stat"
)

type DetectionResult struct {
	IsAnomaly   bool
	AnomalyType string
	Expected    float64
	Severity    float64
}

type STLResult struct {
	Trend    []float64
	Seasonal []float64
	Residual []float64
}

func STLDecompose(data []float64, period int) *STLResult {
	n := len(data)
	if n < period*2 {
		trend := make([]float64, n)
		seasonal := make([]float64, n)
		residual := make([]float64, n)
		mean := stat.Mean(data, nil)
		for i := range data {
			trend[i] = mean
			seasonal[i] = 0
			residual[i] = data[i] - mean
		}
		return &STLResult{Trend: trend, Seasonal: seasonal, Residual: residual}
	}

	trend := loessSmooth(data, period)
	detrended := make([]float64, n)
	for i := range data {
		detrended[i] = data[i] - trend[i]
	}

	seasonal := make([]float64, n)
	for phase := 0; phase < period; phase++ {
		var phaseData []float64
		for i := phase; i < n; i += period {
			phaseData = append(phaseData, detrended[i])
		}
		if len(phaseData) > 0 {
			smoothPhase := loessSmooth(phaseData, 3)
			idx := 0
			for i := phase; i < n; i += period {
				if idx < len(smoothPhase) {
					seasonal[i] = smoothPhase[idx]
				} else {
					seasonal[i] = 0
				}
				idx++
			}
		}
	}

	deseasonalized := make([]float64, n)
	for i := range data {
		deseasonalized[i] = data[i] - seasonal[i]
	}

	finalTrend := loessSmooth(deseasonalized, period)
	residual := make([]float64, n)
	for i := range data {
		residual[i] = data[i] - finalTrend[i] - seasonal[i]
	}

	return &STLResult{
		Trend:    finalTrend,
		Seasonal: seasonal,
		Residual: residual,
	}
}

func loessSmooth(data []float64, width int) []float64 {
	n := len(data)
	smoothed := make([]float64, n)
	if n == 0 {
		return smoothed
	}

	for i := range data {
		start := max(0, i-width/2)
		end := min(n, i+width/2+1)
		window := data[start:end]

		if len(window) == 0 {
			smoothed[i] = data[i]
			continue
		}

		sum := 0.0
		for _, v := range window {
			sum += v
		}
		smoothed[i] = sum / float64(len(window))
	}
	return smoothed
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func ThreeSigmaDetection(values []float64, newValue float64) *DetectionResult {
	n := len(values)
	if n < 5 {
		return &DetectionResult{IsAnomaly: false}
	}

	mean := stat.Mean(values, nil)
	stdDev := stat.StdDev(values, nil)

	if stdDev == 0 {
		return &DetectionResult{IsAnomaly: false}
	}

	zScore := math.Abs(newValue - mean) / stdDev
	threshold := 3.0

	result := &DetectionResult{
		IsAnomaly: zScore > threshold,
		Expected:  mean,
		Severity:  zScore,
	}

	if result.IsAnomaly {
		if n >= 10 {
			recentMean := stat.Mean(values[n-5:], nil)
			overallMean := stat.Mean(values[:n-5], nil)
			stepDiff := math.Abs(recentMean - overallMean) / stdDev

			if stepDiff > 2.0 {
				result.AnomalyType = "step"
			} else if zScore > 4.0 {
				result.AnomalyType = "spike"
			} else {
				result.AnomalyType = "drift"
			}
		} else {
			if zScore > 4.0 {
				result.AnomalyType = "spike"
			} else {
				result.AnomalyType = "drift"
			}
		}
	}

	return result
}

func DetectWithSTL(values []float64, newValue float64) *DetectionResult {
	n := len(values)
	if n < 12 {
		return ThreeSigmaDetection(values, newValue)
	}

	period := 12
	if n < period*2 {
		period = n / 2
	}

	allValues := append(values, newValue)
	stl := STLDecompose(allValues, period)

	residuals := stl.Residual[:n]
	newResidual := stl.Residual[n]

	nResiduals := len(residuals)
	if nResiduals < 5 {
		return ThreeSigmaDetection(values, newValue)
	}

	meanResidual := stat.Mean(residuals, nil)
	stdResidual := stat.StdDev(residuals, nil)

	if stdResidual == 0 {
		return ThreeSigmaDetection(values, newValue)
	}

	zScore := math.Abs(newResidual - meanResidual) / stdResidual
	threshold := 3.5

	result := &DetectionResult{
		IsAnomaly: zScore > threshold,
		Expected:  stl.Trend[n] + stl.Seasonal[n],
		Severity:  zScore,
	}

	if result.IsAnomaly {
		if n >= 20 {
			trend := stl.Trend
			recentTrend := trend[max(0, n-10):n]
			olderTrend := trend[:max(1, n-10)]

			recentMean := stat.Mean(recentTrend, nil)
			olderMean := stat.Mean(olderTrend, nil)

			trendDiff := math.Abs(recentMean - olderMean) / stdResidual

			if zScore > 5.0 {
				result.AnomalyType = "spike"
			} else if trendDiff > 3.0 {
				result.AnomalyType = "step"
			} else {
				result.AnomalyType = "drift"
			}
		} else {
			if zScore > 4.5 {
				result.AnomalyType = "spike"
			} else {
				result.AnomalyType = "drift"
			}
		}
	}

	return result
}

func DetectWithSTLBatch(history []float64, newValues []float64) []*DetectionResult {
	n := len(history)
	results := make([]*DetectionResult, len(newValues))

	if n < 12 {
		for i, nv := range newValues {
			results[i] = ThreeSigmaDetection(history, nv)
		}
		return results
	}

	period := 12
	if n < period*2 {
		period = n / 2
	}

	allValues := append(history, newValues...)
	stl := STLDecompose(allValues, period)

	residuals := stl.Residual[:n]
	meanResidual := stat.Mean(residuals, nil)
	stdResidual := stat.StdDev(residuals, nil)

	if stdResidual == 0 {
		for i, nv := range newValues {
			results[i] = ThreeSigmaDetection(history, nv)
		}
		return results
	}

	threshold := 3.5

	for i := range newValues {
		idx := n + i
		newResidual := stl.Residual[idx]
		zScore := math.Abs(newResidual - meanResidual) / stdResidual

		result := &DetectionResult{
			IsAnomaly: zScore > threshold,
			Expected:  stl.Trend[idx] + stl.Seasonal[idx],
			Severity:  zScore,
		}

		if result.IsAnomaly {
			if zScore > 5.0 {
				result.AnomalyType = "spike"
			} else if zScore > 4.0 {
				result.AnomalyType = "step"
			} else {
				result.AnomalyType = "drift"
			}
		}

		results[i] = result
	}

	applyMedianFilter(results, 3)
	return applyConsecutiveCheck(results, 2)
}

func CalculateSlope(values []float64) float64 {
	n := len(values)
	if n < 2 {
		return 0
	}

	x := make([]float64, n)
	for i := range x {
		x[i] = float64(i)
	}

	return stat.LinearRegression(x, values, nil, false)[0]
}

func Median(values []float64) float64 {
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)
	n := len(sorted)
	if n%2 == 0 {
		return (sorted[n/2-1] + sorted[n/2]) / 2
	}
	return sorted[n/2]
}

func applyMedianFilter(results []*DetectionResult, windowSize int) {
	n := len(results)
	if n < windowSize {
		return
	}

	severities := make([]float64, n)
	for i, r := range results {
		if r.IsAnomaly {
			severities[i] = r.Severity
		}
	}

	halfWindow := windowSize / 2
	for i := halfWindow; i < n-halfWindow; i++ {
		if !results[i].IsAnomaly {
			continue
		}

		window := severities[i-halfWindow : i+halfWindow+1]
		nonZeroCount := 0
		for _, s := range window {
			if s > 0 {
				nonZeroCount++
			}
		}

		if nonZeroCount <= halfWindow {
			results[i].IsAnomaly = false
		}
	}
}

func applyConsecutiveCheck(results []*DetectionResult, minConsecutive int) []*DetectionResult {
	n := len(results)
	if n < minConsecutive {
		return results
	}

	isConsecutiveAnomaly := make([]bool, n)
	count := 0

	for i := 0; i < n; i++ {
		if results[i].IsAnomaly {
			count++
		} else {
			count = 0
		}

		if count >= minConsecutive {
			for j := i - minConsecutive + 1; j <= i; j++ {
				isConsecutiveAnomaly[j] = true
			}
		}
	}

	for i := range results {
		if !isConsecutiveAnomaly[i] {
			results[i].IsAnomaly = false
		}
	}

	return results
}

func MovingAverageFilter(values []float64, windowSize int) []float64 {
	n := len(values)
	if n < windowSize {
		return values
	}

	filtered := make([]float64, n)
	sum := 0.0

	for i := 0; i < windowSize; i++ {
		sum += values[i]
		filtered[i] = values[i]
	}

	for i := windowSize; i < n; i++ {
		sum += values[i] - values[i-windowSize]
		filtered[i] = sum / float64(windowSize)
	}

	return filtered
}
