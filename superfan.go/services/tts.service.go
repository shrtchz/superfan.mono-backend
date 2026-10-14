package services

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/utils"
)

// TTSService provides speech synthesis for quiz questions and options.
type TTSService interface {
	Synthesize(ctx context.Context, text string, lang string) ([]byte, error)
	SynthesizeQuiz(ctx context.Context, quiz *models.Quiz, lang string, includeOptions bool) ([]byte, error)
	SynthesizeLiveQuiz(ctx context.Context, liveQuiz *models.LiveQuiz, lang string, includeOptions bool) ([]byte, error)
}

type ttsServiceImpl struct {
	httpClient *http.Client
	apiKey     string
	mu         sync.RWMutex
	cache      map[string][]byte
	cacheDir   string
}

func NewTTSService() TTSService {
	cacheDir := os.Getenv("TTS_CACHE_DIR")
	if cacheDir == "" {
		cacheDir = filepath.Join(os.TempDir(), "superfan_tts_cache")
	}
	_ = os.MkdirAll(cacheDir, 0755)

	return &ttsServiceImpl{
		httpClient: &http.Client{Timeout: 15 * time.Second},
		apiKey:     utils.GetEnvWithKey("GOOGLE_TTS_API_KEY"),
		cache:      make(map[string][]byte),
		cacheDir:   cacheDir,
	}
}

// normalizeLanguageCode maps friendly language names to ISO 639-1 language codes.
func normalizeLanguageCode(lang string) string {
	l := strings.ToLower(strings.TrimSpace(lang))
	switch {
	case strings.HasPrefix(l, "yo"):
		return "yo"
	case strings.HasPrefix(l, "ig"):
		return "ig"
	case strings.HasPrefix(l, "ha"):
		return "ha"
	case strings.HasPrefix(l, "en"):
		return "en"
	default:
		if l != "" {
			return l
		}
		return "yo"
	}
}

// googleCloudLanguageCode maps to Google Cloud Voice BCP-47 codes (e.g. yo-NG, ig-NG, en-NG).
func googleCloudLanguageCode(langCode string) string {
	switch langCode {
	case "yo":
		return "yo-NG"
	case "ig":
		return "ig-NG"
	case "ha":
		return "ha-NG"
	case "en":
		return "en-NG"
	default:
		return langCode + "-NG"
	}
}

func (s *ttsServiceImpl) cacheKey(text, lang string) string {
	hasher := sha256.New()
	hasher.Write([]byte(lang + ":" + text))
	return hex.EncodeToString(hasher.Sum(nil))
}

func (s *ttsServiceImpl) getCached(key string) []byte {
	s.mu.RLock()
	data, ok := s.cache[key]
	s.mu.RUnlock()
	if ok && len(data) > 0 {
		return data
	}

	// Check disk cache
	if s.cacheDir != "" {
		filePath := filepath.Join(s.cacheDir, key+".mp3")
		diskData, err := os.ReadFile(filePath)
		if err == nil && len(diskData) > 0 {
			s.mu.Lock()
			s.cache[key] = diskData
			s.mu.Unlock()
			return diskData
		}
	}

	return nil
}

func (s *ttsServiceImpl) setCached(key string, data []byte) {
	s.mu.Lock()
	s.cache[key] = data
	s.mu.Unlock()

	if s.cacheDir != "" {
		filePath := filepath.Join(s.cacheDir, key+".mp3")
		_ = os.WriteFile(filePath, data, 0644)
	}
}

// Synthesize generates MP3 audio for the given text in the requested language.
func (s *ttsServiceImpl) Synthesize(ctx context.Context, text string, lang string) ([]byte, error) {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil, errors.New("cannot synthesize empty text")
	}

	langCode := normalizeLanguageCode(lang)
	key := s.cacheKey(trimmed, langCode)

	if cached := s.getCached(key); cached != nil {
		return cached, nil
	}

	var audioBytes []byte
	var err error

	// If a Google Cloud API Key is configured, use the official Cloud Text-to-Speech API
	if s.apiKey != "" {
		audioBytes, err = s.synthesizeViaGoogleCloudAPI(ctx, trimmed, langCode)
	}

	// If no API key is configured or official API failed, fall back to Google public voice endpoint
	if err != nil || len(audioBytes) == 0 {
		audioBytes, err = s.synthesizeViaGoogleVoiceEndpoint(ctx, trimmed, langCode)
	}

	if err != nil {
		return nil, err
	}

	if len(audioBytes) > 0 {
		s.setCached(key, audioBytes)
	}

	return audioBytes, nil
}

// synthesizeViaGoogleCloudAPI calls the Google Cloud Text-to-Speech v1 REST API.
func (s *ttsServiceImpl) synthesizeViaGoogleCloudAPI(ctx context.Context, text, langCode string) ([]byte, error) {
	apiURL := fmt.Sprintf("https://texttospeech.googleapis.com/v1/text:synthesize?key=%s", url.QueryEscape(s.apiKey))

	payload := map[string]interface{}{
		"input": map[string]string{
			"text": text,
		},
		"voice": map[string]string{
			"languageCode": googleCloudLanguageCode(langCode),
		},
		"audioConfig": map[string]interface{}{
			"audioEncoding": "MP3",
			"speakingRate":  1.0,
		},
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("google cloud tts error (status %d): %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		AudioContent string `json:"audioContent"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	if result.AudioContent == "" {
		return nil, errors.New("empty audioContent from Google Cloud TTS")
	}

	return base64.StdEncoding.DecodeString(result.AudioContent)
}

// synthesizeViaGoogleVoiceEndpoint calls Google's speech synthesis engine directly.
// Splits text into natural sentences/phrases if it exceeds length limits and joins the MP3 stream.
func (s *ttsServiceImpl) synthesizeViaGoogleVoiceEndpoint(ctx context.Context, text, langCode string) ([]byte, error) {
	chunks := splitTextForTTS(text, 160)
	if len(chunks) == 0 {
		return nil, errors.New("no readable chunks found in text")
	}

	var fullAudio bytes.Buffer

	for _, chunk := range chunks {
		endpoint := fmt.Sprintf(
			"https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=%s&q=%s",
			url.QueryEscape(langCode),
			url.QueryEscape(chunk),
		)

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
		req.Header.Set("Referer", "https://translate.google.com/")

		resp, err := s.httpClient.Do(req)
		if err != nil {
			return nil, err
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return nil, fmt.Errorf("google voice endpoint returned status %d for chunk", resp.StatusCode)
		}

		chunkBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, err
		}

		fullAudio.Write(chunkBytes)
	}

	return fullAudio.Bytes(), nil
}

// splitTextForTTS splits a long question into natural breath-length chunks (< maxChars).
func splitTextForTTS(text string, maxChars int) []string {
	clean := strings.TrimSpace(text)
	if clean == "" {
		return nil
	}

	if utf8.RuneCountInString(clean) <= maxChars {
		return []string{clean}
	}

	var chunks []string
	// Split by sentences or punctuation first
	delimiters := []string{". ", "? ", "! ", "; ", ", "}

	current := clean
	for len(current) > 0 {
		if utf8.RuneCountInString(current) <= maxChars {
			chunks = append(chunks, strings.TrimSpace(current))
			break
		}

		cutIndex := -1
		for _, delim := range delimiters {
			idx := strings.Index(current, delim)
			if idx > 0 && idx < maxChars {
				cutIndex = idx + len(delim)
				break
			}
		}

		// Fallback to last space before maxChars
		if cutIndex <= 0 {
			spaceIdx := strings.LastIndex(current[:maxChars], " ")
			if spaceIdx > 0 {
				cutIndex = spaceIdx + 1
			} else {
				cutIndex = maxChars
			}
		}

		part := strings.TrimSpace(current[:cutIndex])
		if part != "" {
			chunks = append(chunks, part)
		}
		current = strings.TrimSpace(current[cutIndex:])
	}

	return chunks
}

// formatQuestionScript formats the question and its options into natural read-aloud prose.
func formatQuestionScript(questionText string, options []string, lang string, includeOptions bool) string {
	q := strings.TrimSpace(questionText)
	if !includeOptions || len(options) == 0 {
		return q
	}

	isYoruba := strings.HasPrefix(strings.ToLower(lang), "yo")
	isIgbo := strings.HasPrefix(strings.ToLower(lang), "ig")

	var sb strings.Builder
	sb.WriteString(q)
	sb.WriteString(". ... ")

	for i, opt := range options {
		letter := string('A' + rune(i))
		optTrimmed := strings.TrimSpace(opt)
		if optTrimmed == "" {
			continue
		}

		if isYoruba {
			sb.WriteString(fmt.Sprintf("Àṣàyàn %s: %s. ... ", letter, optTrimmed))
		} else if isIgbo {
			sb.WriteString(fmt.Sprintf("Nhọrọ %s: %s. ... ", letter, optTrimmed))
		} else {
			sb.WriteString(fmt.Sprintf("Option %s: %s. ... ", letter, optTrimmed))
		}
	}

	return strings.TrimSpace(sb.String())
}

func (s *ttsServiceImpl) SynthesizeQuiz(ctx context.Context, quiz *models.Quiz, lang string, includeOptions bool) ([]byte, error) {
	if quiz == nil {
		return nil, errors.New("quiz is nil")
	}
	effectiveLang := lang
	if effectiveLang == "" && quiz.Subject != "" {
		effectiveLang = quiz.Subject
	}
	script := formatQuestionScript(quiz.Question, quiz.Options, effectiveLang, includeOptions)
	return s.Synthesize(ctx, script, effectiveLang)
}

func (s *ttsServiceImpl) SynthesizeLiveQuiz(ctx context.Context, liveQuiz *models.LiveQuiz, lang string, includeOptions bool) ([]byte, error) {
	if liveQuiz == nil {
		return nil, errors.New("liveQuiz is nil")
	}
	script := formatQuestionScript(liveQuiz.Question, liveQuiz.Options, lang, includeOptions)
	return s.Synthesize(ctx, script, lang)
}
