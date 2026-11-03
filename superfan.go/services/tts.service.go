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
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
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

type YarnVoice struct {
	ID        string      `json:"id"`
	Name      string      `json:"name"`
	Default   bool        `json:"default"`
	Language  string      `json:"language"`
	Languages interface{} `json:"languages"`
}

type ttsServiceImpl struct {
	httpClient   *http.Client
	googleKey    string
	yarnGPTKey   string
	quizService  QuizService
	mu           sync.RWMutex
	cache        map[string][]byte
	cacheDir     string
	yarnVoices   []YarnVoice
	yarnVoicesAt time.Time
}

func NewTTSService() TTSService {
	return NewTTSServiceWithQuizService(nil)
}

func NewTTSServiceWithQuizService(quizService QuizService) TTSService {
	cacheDir := os.Getenv("TTS_CACHE_DIR")
	if cacheDir == "" {
		cacheDir = filepath.Join(os.TempDir(), "superfan_tts_cache")
	}
	_ = os.MkdirAll(cacheDir, 0755)

	yarnKey := strings.TrimSpace(os.Getenv("YARNGPT_API_KEY"))
	if yarnKey == "" {
		yarnKey = strings.TrimSpace(utils.GetEnvWithKey("YARNGPT_API_KEY"))
	}

	googleKey := strings.TrimSpace(os.Getenv("GOOGLE_TTS_API_KEY"))
	if googleKey == "" {
		googleKey = strings.TrimSpace(utils.GetEnvWithKey("GOOGLE_TTS_API_KEY"))
	}

	return &ttsServiceImpl{
		httpClient:  &http.Client{Timeout: 30 * time.Second},
		googleKey:   googleKey,
		yarnGPTKey:  yarnKey,
		quizService: quizService,
		cache:       make(map[string][]byte),
		cacheDir:    cacheDir,
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

// fetchAudioFromURL downloads audio from a URL (e.g. Cloudinary CDN) and caches it.
func (s *ttsServiceImpl) fetchAudioFromURL(ctx context.Context, audioURL string) ([]byte, error) {
	key := s.cacheKey(audioURL, "cdn")
	if cached := s.getCached(key); cached != nil {
		return cached, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, audioURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch audio from %s: HTTP %d", audioURL, resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if len(data) > 0 {
		s.setCached(key, data)
	}
	return data, nil
}

// Synthesize generates MP3 audio for the given text.
// Uses YarnGPT first (for natural African voice generation in Yoruba, Igbo, Hausa, Pidgin, English),
// then Google Cloud TTS if configured, then public voice fallback.
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

	// 1. YarnGPT (Primary for African Languages)
	yarnKey := s.yarnGPTKey
	if yarnKey == "" {
		yarnKey = strings.TrimSpace(os.Getenv("YARNGPT_API_KEY"))
	}
	if yarnKey == "" {
		yarnKey = strings.TrimSpace(utils.GetEnvWithKey("YARNGPT_API_KEY"))
	}
	if yarnKey != "" {
		audioBytes, err = s.synthesizeViaYarnGPT(ctx, trimmed, langCode, yarnKey)
		if err == nil && len(audioBytes) > 0 {
			s.setCached(key, audioBytes)
			return audioBytes, nil
		}
		log.Printf("[TTS] YarnGPT error: %v", err)
		// For African languages, return the YarnGPT error directly instead of falling back to Google
		if langCode == "yo" || langCode == "ig" || langCode == "ha" {
			return nil, fmt.Errorf("YarnGPT synthesis failed: %w", err)
		}
	} else if langCode == "yo" || langCode == "ig" || langCode == "ha" {
		return nil, errors.New("YARNGPT_API_KEY is not set in backend environment. Please set YARNGPT_API_KEY in server environment variables to enable African TTS")
	}

	// 2. Google Cloud Text-to-Speech API
	if s.googleKey != "" {
		audioBytes, err = s.synthesizeViaGoogleCloudAPI(ctx, trimmed, langCode)
		if err == nil && len(audioBytes) > 0 {
			s.setCached(key, audioBytes)
			return audioBytes, nil
		}
	}

	// 3. Fallback to Google public voice endpoint (supports English)
	audioBytes, err = s.synthesizeViaGoogleVoiceEndpoint(ctx, trimmed, langCode)
	if err != nil {
		return nil, err
	}

	if len(audioBytes) > 0 {
		s.setCached(key, audioBytes)
	}

	return audioBytes, nil
}

// parseYarnVoices decodes voices catalogue returned by GET /api/v1/voices.
func parseYarnVoices(data []byte) []YarnVoice {
	var list []YarnVoice
	if err := json.Unmarshal(data, &list); err == nil && len(list) > 0 {
		return list
	}
	var wrapper struct {
		Voices []YarnVoice `json:"voices"`
		Data   []YarnVoice `json:"data"`
	}
	if err := json.Unmarshal(data, &wrapper); err == nil {
		if len(wrapper.Voices) > 0 {
			return wrapper.Voices
		}
		if len(wrapper.Data) > 0 {
			return wrapper.Data
		}
	}
	return nil
}

// resolveYarnVoice finds the best voice for the given language.
// If YARNGPT_VOICE is explicitly configured in env, it is used.
// Otherwise it queries GET /api/v1/voices (cached for 1h) or defaults to "umar".
func (s *ttsServiceImpl) resolveYarnVoice(ctx context.Context, langCode, apiKey string) string {
	// 1. Explicit environment variable override
	if v := strings.TrimSpace(os.Getenv("YARNGPT_VOICE")); v != "" {
		return v
	}
	if v := strings.TrimSpace(utils.GetEnvWithKey("YARNGPT_VOICE")); v != "" {
		return v
	}

	// 2. Read from in-memory cache
	s.mu.RLock()
	cached := s.yarnVoices
	cachedAt := s.yarnVoicesAt
	s.mu.RUnlock()

	var voices []YarnVoice
	if len(cached) > 0 && time.Since(cachedAt) < 1*time.Hour {
		voices = cached
	} else if apiKey != "" {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.yarngpt.ai/api/v1/voices", nil)
		if err == nil {
			req.Header.Set("Authorization", "Bearer "+apiKey)
			resp, err := s.httpClient.Do(req)
			if err == nil && resp.StatusCode == http.StatusOK {
				defer resp.Body.Close()
				body, _ := io.ReadAll(resp.Body)
				voices = parseYarnVoices(body)
				if len(voices) > 0 {
					log.Printf("[TTS] Loaded %d voices from YarnGPT catalogue", len(voices))
					s.mu.Lock()
					s.yarnVoices = voices
					s.yarnVoicesAt = time.Now()
					s.mu.Unlock()
				}
			} else if resp != nil {
				resp.Body.Close()
			}
		}
	}

	// 3. Match voice by language
	target := strings.ToLower(normalizeLanguageCode(langCode))
	var defaultVoice string
	for _, v := range voices {
		vid := v.ID
		if vid == "" {
			vid = v.Name
		}
		if vid == "" {
			continue
		}
		if defaultVoice == "" || v.Default {
			defaultVoice = vid
		}
		if strings.Contains(strings.ToLower(v.Language), target) {
			return vid
		}
		if arr, ok := v.Languages.([]interface{}); ok {
			for _, item := range arr {
				if str, ok := item.(string); ok && strings.ToLower(str) == target {
					return vid
				}
			}
		}
	}

	if defaultVoice != "" {
		return defaultVoice
	}

	// 4. Default African speaker recognized on YarnGPT
	return "umar"
}

// pollYarnGPTJob polls GET /api/v1/status/{job_id} until completed.
func (s *ttsServiceImpl) pollYarnGPTJob(ctx context.Context, jobID, apiKey string) ([]byte, error) {
	statusURL := "https://api.yarngpt.ai/api/v1/status/" + jobID
	deadline := time.Now().Add(25 * time.Second)

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(600 * time.Millisecond):
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, statusURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+apiKey)

		resp, err := s.httpClient.Do(req)
		if err != nil {
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var statusResp struct {
			Status   string `json:"status"`
			AudioURL string `json:"audio_url"`
		}
		if json.Unmarshal(body, &statusResp) == nil {
			if statusResp.Status == "completed" && statusResp.AudioURL != "" {
				return s.fetchAudioFromURL(ctx, statusResp.AudioURL)
			}
			if statusResp.Status == "failed" {
				return nil, fmt.Errorf("yarngpt job failed: %s", string(body))
			}
		}
	}
	return nil, errors.New("yarngpt job polling timed out")
}

// synthesizeViaYarnGPT calls YarnGPT's African Text-to-Speech API.
// https://yarngpt.ai/api-docs
func (s *ttsServiceImpl) synthesizeViaYarnGPT(ctx context.Context, text, langCode, apiKey string) ([]byte, error) {
	idempotencyKey := fmt.Sprintf("superfan-%x", sha256.Sum256([]byte(text+langCode+strconv.FormatInt(time.Now().Unix()/300, 10))))
	voice := s.resolveYarnVoice(ctx, langCode, apiKey)

	// Payload with voice (required by YarnGPT API validation)
	payload := map[string]interface{}{
		"text":          text,
		"voice":         voice,
		"output_format": "mp3",
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	// Method A: Single-turn streaming conversation endpoint (fastest, direct MP3 stream)
	conversationURL := "https://api.yarngpt.ai/api/v1/streaming/conversation"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, conversationURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", idempotencyKey)

	resp, err := s.httpClient.Do(req)
	var streamErr error
	if err == nil {
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			data, readErr := io.ReadAll(resp.Body)
			if readErr == nil && len(data) > 100 {
				log.Printf("[TTS] YarnGPT streaming conversation successful (voice: %s, %d bytes)", voice, len(data))
				return data, nil
			}
			streamErr = readErr
		} else {
			respBody, _ := io.ReadAll(resp.Body)
			streamErr = fmt.Errorf("YarnGPT streaming HTTP %d: %s", resp.StatusCode, string(respBody))
			log.Printf("[TTS] %v", streamErr)
		}
	} else {
		streamErr = err
	}

	// Method B: Low-latency prepare and stream ticket endpoint
	prepareURL := "https://api.yarngpt.ai/api/v1/tts/prepare"
	pReq, err := http.NewRequestWithContext(ctx, http.MethodPost, prepareURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	pReq.Header.Set("Authorization", "Bearer "+apiKey)
	pReq.Header.Set("Content-Type", "application/json")
	pReq.Header.Set("Idempotency-Key", idempotencyKey)

	pResp, err := s.httpClient.Do(pReq)
	if err != nil {
		if streamErr != nil {
			return nil, fmt.Errorf("%w; prepare failed: %v", streamErr, err)
		}
		return nil, fmt.Errorf("yarngpt prepare failed: %w", err)
	}
	defer pResp.Body.Close()

	pBody, _ := io.ReadAll(pResp.Body)
	if pResp.StatusCode == http.StatusOK || pResp.StatusCode == http.StatusAccepted {
		var prepResult struct {
			Ticket    string `json:"ticket"`
			StreamURL string `json:"stream_url"`
		}
		if err := json.Unmarshal(pBody, &prepResult); err == nil {
			fetchURL := prepResult.StreamURL
			if fetchURL == "" && prepResult.Ticket != "" {
				fetchURL = "/api/v1/tts/stream/" + prepResult.Ticket
			}
			if !strings.HasPrefix(fetchURL, "http") {
				fetchURL = "https://api.yarngpt.ai" + fetchURL
			}

			clientWithRedirect := &http.Client{
				Timeout: 30 * time.Second,
				CheckRedirect: func(req *http.Request, via []*http.Request) error {
					if len(via) >= 10 {
						return errors.New("stopped after 10 redirects")
					}
					return nil
				},
			}
			sReq, sErr := http.NewRequestWithContext(ctx, http.MethodGet, fetchURL, nil)
			if sErr == nil {
				sResp, doErr := clientWithRedirect.Do(sReq)
				if doErr == nil {
					defer sResp.Body.Close()
					if sResp.StatusCode == http.StatusOK {
						audioData, rErr := io.ReadAll(sResp.Body)
						if rErr == nil && len(audioData) > 100 {
							log.Printf("[TTS] YarnGPT prepare/stream successful (voice: %s, %d bytes)", voice, len(audioData))
							return audioData, nil
						}
					}
				}
			}
		}
	}

	// Method C: Standard async TTS job with status polling
	ttsURL := "https://api.yarngpt.ai/api/v1/tts"
	jReq, err := http.NewRequestWithContext(ctx, http.MethodPost, ttsURL, bytes.NewReader(bodyBytes))
	if err == nil {
		jReq.Header.Set("Authorization", "Bearer "+apiKey)
		jReq.Header.Set("Content-Type", "application/json")
		jReq.Header.Set("Idempotency-Key", idempotencyKey)

		jResp, jErr := s.httpClient.Do(jReq)
		if jErr == nil {
			defer jResp.Body.Close()
			jBody, _ := io.ReadAll(jResp.Body)
			if jResp.StatusCode == http.StatusOK || jResp.StatusCode == http.StatusAccepted {
				var jobResult struct {
					JobID string `json:"job_id"`
				}
				if json.Unmarshal(jBody, &jobResult) == nil && jobResult.JobID != "" {
					audioData, pollErr := s.pollYarnGPTJob(ctx, jobResult.JobID, apiKey)
					if pollErr == nil && len(audioData) > 100 {
						log.Printf("[TTS] YarnGPT job polling successful (voice: %s, %d bytes)", voice, len(audioData))
						return audioData, nil
					}
				}
			}
		}
	}

	if streamErr != nil {
		return nil, streamErr
	}
	return nil, fmt.Errorf("yarngpt prepare returned HTTP %d: %s", pResp.StatusCode, string(pBody))
}

// synthesizeViaGoogleCloudAPI calls the Google Cloud Text-to-Speech v1 REST API.
func (s *ttsServiceImpl) synthesizeViaGoogleCloudAPI(ctx context.Context, text, langCode string) ([]byte, error) {
	apiURL := fmt.Sprintf("https://texttospeech.googleapis.com/v1/text:synthesize?key=%s", url.QueryEscape(s.googleKey))

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
	langCode := normalizeLanguageCode(effectiveLang)

	// 1. Check if Cloudinary audio URL is already stored for this Quiz
	var existingAudioURL string
	if quiz.AudioURLs != nil && quiz.AudioURLs[langCode] != "" {
		existingAudioURL = quiz.AudioURLs[langCode]
	} else if quiz.AudioURL != "" && (langCode == "yo" || len(quiz.AudioURLs) == 0) {
		existingAudioURL = quiz.AudioURL
	}

	if existingAudioURL != "" {
		audioBytes, err := s.fetchAudioFromURL(ctx, existingAudioURL)
		if err == nil && len(audioBytes) > 0 {
			log.Printf("[TTS] Reusing existing Cloudinary audio for Quiz %s (%s): %s", quiz.IDHex, langCode, existingAudioURL)
			return audioBytes, nil
		}
	}

	// 2. Synthesize audio
	script := formatQuestionScript(quiz.Question, quiz.Options, effectiveLang, includeOptions)
	audioBytes, err := s.Synthesize(ctx, script, effectiveLang)
	if err != nil {
		return nil, err
	}

	// 3. Upload to Cloudinary and update MongoDB Quiz (so audio is never regenerated for this question)
	if len(audioBytes) > 0 {
		quizID := quiz.IDHex
		if quizID == "" && !quiz.ID.IsZero() {
			quizID = quiz.ID.Hex()
		}
		if quizID != "" {
			publicID := fmt.Sprintf("quiz_%s_%s", quizID, langCode)
			filename := fmt.Sprintf("quiz_%s_%s.mp3", quizID, langCode)
			cdnURL, uploadErr := UploadAudioBytesToCloudinary(audioBytes, filename, publicID)
			if uploadErr == nil && cdnURL != "" {
				quiz.AudioURL = cdnURL
				if quiz.AudioURLs == nil {
					quiz.AudioURLs = make(map[string]string)
				}
				quiz.AudioURLs[langCode] = cdnURL
				if s.quizService != nil {
					_ = s.quizService.UpdateQuizAudioURL(quizID, langCode, cdnURL)
				}
				log.Printf("[TTS] Uploaded & cached audio to Cloudinary for Quiz %s (%s) -> %s", quizID, langCode, cdnURL)
			} else {
				log.Printf("[TTS] Cloudinary upload note: %v", uploadErr)
			}
		}
	}

	return audioBytes, nil
}

func (s *ttsServiceImpl) SynthesizeLiveQuiz(ctx context.Context, liveQuiz *models.LiveQuiz, lang string, includeOptions bool) ([]byte, error) {
	if liveQuiz == nil {
		return nil, errors.New("liveQuiz is nil")
	}
	effectiveLang := lang
	langCode := normalizeLanguageCode(effectiveLang)

	// 1. Check if Cloudinary audio URL is already stored for this LiveQuiz
	var existingAudioURL string
	if liveQuiz.AudioURLs != nil && liveQuiz.AudioURLs[langCode] != "" {
		existingAudioURL = liveQuiz.AudioURLs[langCode]
	} else if liveQuiz.AudioURL != "" && (langCode == "yo" || len(liveQuiz.AudioURLs) == 0) {
		existingAudioURL = liveQuiz.AudioURL
	}

	if existingAudioURL != "" {
		audioBytes, err := s.fetchAudioFromURL(ctx, existingAudioURL)
		if err == nil && len(audioBytes) > 0 {
			log.Printf("[TTS] Reusing existing Cloudinary audio for LiveQuiz %s (%s): %s", liveQuiz.IDHex, langCode, existingAudioURL)
			return audioBytes, nil
		}
	}

	// 2. Synthesize audio
	script := formatQuestionScript(liveQuiz.Question, liveQuiz.Options, effectiveLang, includeOptions)
	audioBytes, err := s.Synthesize(ctx, script, effectiveLang)
	if err != nil {
		return nil, err
	}

	// 3. Upload to Cloudinary and update MongoDB LiveQuiz
	if len(audioBytes) > 0 {
		quizID := liveQuiz.IDHex
		if quizID == "" && !liveQuiz.ID.IsZero() {
			quizID = liveQuiz.ID.Hex()
		}
		if quizID != "" {
			publicID := fmt.Sprintf("live_quiz_%s_%s", quizID, langCode)
			filename := fmt.Sprintf("live_quiz_%s_%s.mp3", quizID, langCode)
			cdnURL, uploadErr := UploadAudioBytesToCloudinary(audioBytes, filename, publicID)
			if uploadErr == nil && cdnURL != "" {
				liveQuiz.AudioURL = cdnURL
				if liveQuiz.AudioURLs == nil {
					liveQuiz.AudioURLs = make(map[string]string)
				}
				liveQuiz.AudioURLs[langCode] = cdnURL
				if s.quizService != nil {
					_ = s.quizService.UpdateLiveQuizAudioURL(quizID, langCode, cdnURL)
				}
				log.Printf("[TTS] Uploaded & cached audio to Cloudinary for LiveQuiz %s (%s) -> %s", quizID, langCode, cdnURL)
			}
		}
	}

	return audioBytes, nil
}
