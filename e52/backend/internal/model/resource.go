package model

import (
	"crypto/sha1"
	"encoding/hex"
	"time"
)

const ChunkSize = 1024 * 1024

type Resource struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Size         int64     "json:\"size\""
	ChunkCount   int       `json:"chunkCount"`
	ChunkSize    int       `json:"chunkSize"`
	InfoHash     string    `json:"infoHash"`
	MagnetLink   string    `json:"magnetLink"`
	Chunks       []Chunk   `json:"chunks,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
	DownloadCount int      `json:"downloadCount"`
	Seeders      int       `json:"seeders"`
	Leechers     int       `json:"leechers"`
	HotScore     float64   `json:"hotScore"`
}

type Chunk struct {
	Index int    `json:"index"`
	Hash  string `json:"hash"`
	Size  int    `json:"size"`
	Data  []byte `json:"-"`
}

type Peer struct {
	ID         string    `json:"id"`
	InfoHash   string    `json:"infoHash"`
	IP         string    `json:"ip"`
	Port       int       `json:"port"`
	IsSeeder   bool      `json:"isSeeder"`
	LastSeen   time.Time `json:"lastSeen"`
	Downloaded int64     `json:"downloaded"`
	Uploaded   int64     `json:"uploaded"`
	GeoInfo    GeoLocation `json:"geoInfo"`
}

type GeoLocation struct {
	Country     string  `json:"country"`
	CountryCode string  `json:"countryCode"`
	Region      string  `json:"region"`
	City        string  `json:"city"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	ISP         string  `json:"isp"`
	Timezone    string  `json:"timezone"`
}

type ChunkPeerInfo struct {
	ChunkHash string   `json:"chunkHash"`
	PeerIDs   []string `json:"peerIds"`
	Peers     []Peer   `json:"peers"`
}

func GenerateInfoHash(name string, chunks []Chunk) string {
	h := sha1.New()
	h.Write([]byte(name))
	for _, chunk := range chunks {
		h.Write([]byte(chunk.Hash))
	}
	return hex.EncodeToString(h.Sum(nil))
}

func GenerateMagnetLink(infoHash, name string) string {
	return "magnet:?xt=urn:btih:" + infoHash + "&dn=" + name
}
