package services

import (
	"strings"
	"testing"
)

func TestTTS_NormalizeLanguageCode(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"yoruba", "yo"},
		{"Yoruba", "yo"},
		{"YO", "yo"},
		{"igbo", "ig"},
		{"Igbo", "ig"},
		{"hausa", "ha"},
		{"english", "en"},
		{"EN", "en"},
		{"", "yo"},
	}

	for _, tc := range tests {
		got := normalizeLanguageCode(tc.input)
		if got != tc.want {
			t.Errorf("normalizeLanguageCode(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestTTS_FormatQuestionScript(t *testing.T) {
	q := "Kí ni olú-ìlú Nàìjíríà?"
	opts := []string{"Èkó", "Àbújá", "Kánò"}

	// Yorùbá formatting
	scriptYo := formatQuestionScript(q, opts, "yo", true)
	if !strings.Contains(scriptYo, "Àṣàyàn A: Èkó") {
		t.Errorf("expected script to contain 'Àṣàyàn A: Èkó', got: %s", scriptYo)
	}
	if !strings.Contains(scriptYo, "Àṣàyàn B: Àbújá") {
		t.Errorf("expected script to contain 'Àṣàyàn B: Àbújá', got: %s", scriptYo)
	}

	// Igbo formatting
	scriptIg := formatQuestionScript("Gịnị bụ isi obodo Naịjirịa?", opts, "ig", true)
	if !strings.Contains(scriptIg, "Nhọrọ A: Èkó") {
		t.Errorf("expected script to contain 'Nhọrọ A: Èkó', got: %s", scriptIg)
	}

	// Without options
	scriptNoOpts := formatQuestionScript(q, opts, "yo", false)
	if strings.Contains(scriptNoOpts, "Àṣàyàn") {
		t.Errorf("expected script without options to not contain 'Àṣàyàn'")
	}
}

func TestTTS_SplitTextForTTS(t *testing.T) {
	short := "E kaaro o, bawo ni gbogbo nkan?"
	chunks := splitTextForTTS(short, 100)
	if len(chunks) != 1 || chunks[0] != short {
		t.Errorf("expected 1 chunk, got %d", len(chunks))
	}

	long := "Ibeere akọkọ ni eyi. Kí ni orúkọ ọba tí ó kọ́kọ́ jẹ ní Ìbàdàn? Àṣàyàn A: Baale Oyesile. Àṣàyàn B: Baale Olugbode. Àṣàyàn D: Iba Oluyole."
	chunksLong := splitTextForTTS(long, 50)
	if len(chunksLong) <= 1 {
		t.Errorf("expected text to be split into multiple chunks, got %d", len(chunksLong))
	}

	// Ensure no chunk exceeds max limit
	for i, c := range chunksLong {
		if len(c) > 60 {
			t.Errorf("chunk %d exceeded expected size limit: %q", i, c)
		}
	}
}
