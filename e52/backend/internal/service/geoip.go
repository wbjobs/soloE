package service

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net"
	"net/http"
	"sync"
	"time"

	"p2p-cdn/internal/model"
)

type GeoIPService struct {
	cache      map[string]model.GeoLocation
	cacheMutex sync.RWMutex
	httpClient *http.Client
}

type IPAPIResponse struct {
	Status      string  `json:"status"`
	Country     string  `json:"country"`
	CountryCode string  `json:"countryCode"`
	Region      string  `json:"region"`
	City        string  `json:"city"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	ISP         string  `json:"isp"`
	Timezone    string  `json:"timezone"`
	Message     string  `json:"message"`
}

func NewGeoIPService() *GeoIPService {
	return &GeoIPService{
		cache: make(map[string]model.GeoLocation),
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

func (gis *GeoIPService) GetLocation(ip string) (model.GeoLocation, error) {
	if ip == "127.0.0.1" || ip == "::1" || ip == "localhost" {
		return model.GeoLocation{
			Country:     "Local",
			CountryCode: "LO",
			Region:      "Local",
			City:        "Localhost",
			Latitude:    0,
			Longitude:   0,
			ISP:         "Local Network",
			Timezone:    "Local",
		}, nil
	}

	gis.cacheMutex.RLock()
	if loc, exists := gis.cache[ip]; exists {
		gis.cacheMutex.RUnlock()
		return loc, nil
	}
	gis.cacheMutex.RUnlock()

	location, err := gis.queryIPAPI(ip)
	if err != nil {
		location = gis.getFallbackLocation(ip)
	}

	gis.cacheMutex.Lock()
	gis.cache[ip] = location
	gis.cacheMutex.Unlock()

	return location, nil
}

func (gis *GeoIPService) queryIPAPI(ip string) (model.GeoLocation, error) {
	url := fmt.Sprintf("http://ip-api.com/json/%s", ip)
	resp, err := gis.httpClient.Get(url)
	if err != nil {
		return model.GeoLocation{}, err
	}
	defer resp.Body.Close()

	var apiResp IPAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return model.GeoLocation{}, err
	}

	if apiResp.Status != "success" {
		return model.GeoLocation{}, fmt.Errorf("IP API error: %s", apiResp.Message)
	}

	return model.GeoLocation{
		Country:     apiResp.Country,
		CountryCode: apiResp.CountryCode,
		Region:      apiResp.Region,
		City:        apiResp.City,
		Latitude:    apiResp.Lat,
		Longitude:   apiResp.Lon,
		ISP:         apiResp.ISP,
		Timezone:    apiResp.Timezone,
	}, nil
}

func (gis *GeoIPService) getFallbackLocation(ip string) model.GeoLocation {
	parsedIP := net.ParseIP(ip)
	var seed int64 = 0
	if parsedIP != nil {
		for _, b := range parsedIP.To4() {
			seed = (seed << 8) | int64(b)
		}
	}

	r := rand.New(rand.NewSource(seed))
	regions := []struct {
		country     string
		countryCode string
		region      string
		cities      []string
		latBase     float64
		lonBase     float64
	}{
		{"China", "CN", "Asia", []string{"Beijing", "Shanghai", "Guangzhou", "Shenzhen", "Hangzhou"}, 35.0, 105.0},
		{"United States", "US", "North America", []string{"New York", "Los Angeles", "San Francisco", "Seattle", "Chicago"}, 37.0, -95.0},
		{"Japan", "JP", "Asia", []string{"Tokyo", "Osaka", "Kyoto", "Nagoya", "Yokohama"}, 36.0, 138.0},
		{"Germany", "DE", "Europe", []string{"Berlin", "Munich", "Frankfurt", "Hamburg", "Cologne"}, 51.0, 10.0},
		{"United Kingdom", "GB", "Europe", []string{"London", "Manchester", "Birmingham", "Leeds", "Glasgow"}, 54.0, -2.0},
		{"South Korea", "KR", "Asia", []string{"Seoul", "Busan", "Incheon", "Daegu", "Daejeon"}, 36.0, 127.5},
		{"Australia", "AU", "Oceania", []string{"Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide"}, -25.0, 134.0},
		{"Russia", "RU", "Europe", []string{"Moscow", "Saint Petersburg", "Novosibirsk", "Yekaterinburg", "Kazan"}, 55.0, 37.0},
	}

	regionIdx := r.Intn(len(regions))
	region := regions[regionIdx]
	city := region.cities[r.Intn(len(region.cities))]

	return model.GeoLocation{
		Country:     region.country,
		CountryCode: region.countryCode,
		Region:      region.region,
		City:        city,
		Latitude:    region.latBase + (r.Float64()-0.5)*10,
		Longitude:   region.lonBase + (r.Float64()-0.5)*10,
		ISP:         "Unknown ISP",
		Timezone:    "Unknown",
	}
}

func (gis *GeoIPService) BatchGetLocations(ips []string) map[string]model.GeoLocation {
	result := make(map[string]model.GeoLocation)
	for _, ip := range ips {
		loc, _ := gis.GetLocation(ip)
		result[ip] = loc
	}
	return result
}

func (gis *GeoIPService) ClearCache() {
	gis.cacheMutex.Lock()
	defer gis.cacheMutex.Unlock()
	gis.cache = make(map[string]model.GeoLocation)
}

func (gis *GeoIPService) GetCacheSize() int {
	gis.cacheMutex.RLock()
	defer gis.cacheMutex.RUnlock()
	return len(gis.cache)
}

type GeoStats struct {
	ByCountry   map[string]int `json:"byCountry"`
	ByRegion    map[string]int `json:"byRegion"`
	TotalPeers  int            `json:"totalPeers"`
}

func (gis *GeoIPService) CalculateGeoStats(peers []model.Peer) GeoStats {
	stats := GeoStats{
		ByCountry:  make(map[string]int),
		ByRegion:   make(map[string]int),
		TotalPeers: len(peers),
	}

	for _, peer := range peers {
		if peer.GeoInfo.Country != "" {
			stats.ByCountry[peer.GeoInfo.Country]++
		}
		if peer.GeoInfo.Region != "" {
			stats.ByRegion[peer.GeoInfo.Region]++
		}
	}

	return stats
}

func GenerateRandomIP() string {
	return fmt.Sprintf("%d.%d.%d.%d", rand.Intn(256), rand.Intn(256), rand.Intn(256), rand.Intn(256))
}

type Peer struct {
	ID       string        `json:"id"`
	IP       string        `json:"ip"`
	GeoInfo  GeoLocation   `json:"geoInfo"`
	IsSeeder bool          `json:"isSeeder"`
}
