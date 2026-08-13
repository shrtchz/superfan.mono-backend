package services

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	cloudinaryCacheMu sync.RWMutex
	cloudinaryCache   = make(map[string]string) // raw Airtable URL -> Cloudinary secure_url
)

type CloudinaryUploadResponse struct {
	PublicID  string `json:"public_id"`
	SecureURL string `json:"secure_url"`
	URL       string `json:"url"`
	Format    string `json:"format"`
	Error     *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// MirrorImagesToCloudinary takes a list of image URLs from Airtable,
// uploads them to Cloudinary CDN, and returns the permanent Cloudinary secure URLs.
// If an image is already hosted on Cloudinary or upload fails, it gracefully handles it.
func MirrorImagesToCloudinary(imageURLs []string) []string {
	if len(imageURLs) == 0 {
		return imageURLs
	}

	cloudName := strings.TrimSpace(os.Getenv("CLOUDINARY_CLOUD_NAME"))
	apiKey := strings.TrimSpace(os.Getenv("CLOUDINARY_API_KEY"))
	apiSecret := strings.TrimSpace(os.Getenv("CLOUDINARY_API_SECRET"))

	if cloudName == "" || apiKey == "" || apiSecret == "" {
		log.Println("[Cloudinary] CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, or CLOUDINARY_API_SECRET not set; keeping original URLs.")
		return imageURLs
	}

	result := make([]string, 0, len(imageURLs))
	for _, rawURL := range imageURLs {
		trimmed := strings.TrimSpace(rawURL)
		if trimmed == "" {
			continue
		}

		cdnURL, err := UploadImageToCloudinary(trimmed, cloudName, apiKey, apiSecret)
		if err != nil {
			log.Printf("[Cloudinary] Failed to upload %s: %v. Falling back to original URL.", trimmed, err)
			result = append(result, trimmed)
		} else {
			result = append(result, cdnURL)
		}
	}

	return result
}

// UploadImageToCloudinary uploads an image from a URL to Cloudinary and returns the permanent secure_url.
func UploadImageToCloudinary(imageURL, cloudName, apiKey, apiSecret string) (string, error) {
	// If already on Cloudinary, skip re-uploading
	if strings.Contains(imageURL, "res.cloudinary.com") || strings.Contains(imageURL, "cloudinary.com") {
		return imageURL, nil
	}

	// Check in-memory cache
	cloudinaryCacheMu.RLock()
	if cached, ok := cloudinaryCache[imageURL]; ok && cached != "" {
		cloudinaryCacheMu.RUnlock()
		return cached, nil
	}
	cloudinaryCacheMu.RUnlock()

	// Step 1: Download the raw image bytes from Airtable
	imageData, contentType, filename, err := downloadImageBytes(imageURL)
	if err != nil {
		return "", fmt.Errorf("download image failed: %w", err)
	}

	// Step 2: Prepare Cloudinary upload parameters and signature
	folder := strings.TrimSpace(os.Getenv("CLOUDINARY_UPLOAD_FOLDER"))
	if folder == "" {
		folder = "superfan_quizzes"
	}

	timestamp := strconv.FormatInt(time.Now().Unix(), 10)

	paramsToSign := map[string]string{
		"timestamp": timestamp,
	}
	if folder != "" {
		paramsToSign["folder"] = folder
	}

	signature := generateCloudinarySignature(paramsToSign, apiSecret)

	// Step 3: Build multipart/form-data request
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	for k, v := range paramsToSign {
		if err := writer.WriteField(k, v); err != nil {
			return "", fmt.Errorf("write field %s failed: %w", k, err)
		}
	}
	if err := writer.WriteField("api_key", apiKey); err != nil {
		return "", fmt.Errorf("write api_key failed: %w", err)
	}
	if err := writer.WriteField("signature", signature); err != nil {
		return "", fmt.Errorf("write signature failed: %w", err)
	}

	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return "", fmt.Errorf("create form file failed: %w", err)
	}
	if _, err := part.Write(imageData); err != nil {
		return "", fmt.Errorf("write image bytes failed: %w", err)
	}

	if err := writer.Close(); err != nil {
		return "", fmt.Errorf("close multipart writer failed: %w", err)
	}

	// Step 4: Execute HTTP POST to Cloudinary API
	uploadEndpoint := fmt.Sprintf("https://api.cloudinary.com/v1_1/%s/image/upload", url.PathEscape(cloudName))
	req, err := http.NewRequest("POST", uploadEndpoint, &body)
	if err != nil {
		return "", fmt.Errorf("create request failed: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{Timeout: 45 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("cloudinary upload request failed: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("reading response failed: %w", err)
	}

	var uploadResp CloudinaryUploadResponse
	if err := json.Unmarshal(respBytes, &uploadResp); err != nil {
		return "", fmt.Errorf("decode cloudinary response failed: %w (body: %s)", err, string(respBytes))
	}

	if uploadResp.Error != nil && uploadResp.Error.Message != "" {
		return "", fmt.Errorf("cloudinary api error: %s", uploadResp.Error.Message)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("cloudinary returned HTTP %d: %s", resp.StatusCode, string(respBytes))
	}

	finalURL := uploadResp.SecureURL
	if finalURL == "" {
		finalURL = uploadResp.URL
	}
	if finalURL == "" {
		return "", fmt.Errorf("empty secure_url in cloudinary response: %s", string(respBytes))
	}

	// Cache result
	cloudinaryCacheMu.Lock()
	cloudinaryCache[imageURL] = finalURL
	cloudinaryCacheMu.Unlock()

	log.Printf("[Cloudinary] Uploaded image (%s, %d bytes) -> %s", contentType, len(imageData), finalURL)
	return finalURL, nil
}

// downloadImageBytes downloads image data from URL
func downloadImageBytes(imageURL string) ([]byte, string, string, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("GET", imageURL, nil)
	if err != nil {
		return nil, "", "", err
	}
	req.Header.Set("User-Agent", "Superfan-Backend/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, "", "", fmt.Errorf("HTTP status %d", resp.StatusCode)
	}

	// Safety cap: 25 MB max per image
	data, err := io.ReadAll(io.LimitReader(resp.Body, 25<<20))
	if err != nil {
		return nil, "", "", err
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/jpeg"
	}
	if idx := strings.Index(contentType, ";"); idx != -1 {
		contentType = strings.TrimSpace(contentType[:idx])
	}

	// Determine a reasonable filename
	parsedURL, _ := url.Parse(imageURL)
	filename := "image.jpg"
	if parsedURL != nil && parsedURL.Path != "" {
		base := filepath.Base(parsedURL.Path)
		if base != "" && base != "." && base != "/" {
			filename = base
		}
	}

	return data, contentType, filename, nil
}

// generateCloudinarySignature calculates the SHA-1 signature according to Cloudinary specs:
// 1. Sort all parameters alphabetically by key.
// 2. Join as key=value&key2=value2.
// 3. Append apiSecret.
// 4. Return hex(sha1(stringToSign)).
func generateCloudinarySignature(params map[string]string, apiSecret string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var pairs []string
	for _, k := range keys {
		pairs = append(pairs, fmt.Sprintf("%s=%s", k, params[k]))
	}

	stringToSign := strings.Join(pairs, "&") + apiSecret
	hash := sha1.Sum([]byte(stringToSign))
	return hex.EncodeToString(hash[:])
}
