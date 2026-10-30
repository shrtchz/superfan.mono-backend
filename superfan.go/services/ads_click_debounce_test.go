package services

import (
	"context"
	"testing"
	"time"
)

func TestClickDebouncer_SingleUserSingleAd(t *testing.T) {
	debouncer := NewClickDebouncer()
	key := getClickDebounceKey(func() *int { id := 42; return &id }(), "", 10)
	t0 := time.Now()

	// 1. Initial click: should be counted
	if !debouncer.ShouldCountClick(key, t0) {
		t.Fatalf("expected initial click to be counted")
	}

	// 2. Click after 1 second: should be debounced / ignored
	if debouncer.ShouldCountClick(key, t0.Add(1*time.Second)) {
		t.Errorf("expected click at t0+1s to be ignored")
	}

	// 3. Click after 3 seconds: should be debounced / ignored
	if debouncer.ShouldCountClick(key, t0.Add(3*time.Second)) {
		t.Errorf("expected click at t0+3s to be ignored")
	}

	// 4. Click at 4.9 seconds: should still be debounced (< 5s from t0)
	if debouncer.ShouldCountClick(key, t0.Add(4900*time.Millisecond)) {
		t.Errorf("expected click at t0+4.9s to be ignored")
	}

	// 5. Click at 5.05 seconds: should be counted (> 5s from t0)
	t1 := t0.Add(5050 * time.Millisecond)
	if !debouncer.ShouldCountClick(key, t1) {
		t.Errorf("expected click at t0+5.05s to be counted")
	}

	// 6. Click at 6.0 seconds: should be debounced (< 5s from t1)
	if debouncer.ShouldCountClick(key, t0.Add(6*time.Second)) {
		t.Errorf("expected click at t0+6.0s to be ignored (only ~1s after last counted click at t1)")
	}
}

func TestClickDebouncer_TimerMeasuredStrictlyFromLastCountedClick(t *testing.T) {
	debouncer := NewClickDebouncer()
	key := "u:1:ad:10"
	t0 := time.Now()

	// t0: counted
	if !debouncer.ShouldCountClick(key, t0) {
		t.Fatalf("first click should be counted")
	}

	// Spam clicks every 1 second should all be ignored and MUST NOT push back the next valid window
	for sec := 1; sec <= 4; sec++ {
		clickTime := t0.Add(time.Duration(sec) * time.Second)
		if debouncer.ShouldCountClick(key, clickTime) {
			t.Errorf("spam click at sec %d should be ignored", sec)
		}
	}

	// At 5.1s from t0, next click must be counted despite the spam at 4s
	t5 := t0.Add(5100 * time.Millisecond)
	if !debouncer.ShouldCountClick(key, t5) {
		t.Errorf("click at 5.1s should be counted (debounce must be measured from last counted click, not last ignored click)")
	}
}

func TestClickDebouncer_MultipleUsersSameAd(t *testing.T) {
	debouncer := NewClickDebouncer()
	u1 := 101
	u2 := 102
	adID := 55
	t0 := time.Now()

	key1 := getClickDebounceKey(&u1, "", adID)
	key2 := getClickDebounceKey(&u2, "", adID)

	// User 1 clicks at t0
	if !debouncer.ShouldCountClick(key1, t0) {
		t.Errorf("User 1 initial click should be counted")
	}

	// User 2 clicks at t0 + 1s (independent debounce per user ID per ad)
	if !debouncer.ShouldCountClick(key2, t0.Add(1*time.Second)) {
		t.Errorf("User 2 click should be counted independently of User 1")
	}

	// User 1 clicks again at t0 + 2s (ignored)
	if debouncer.ShouldCountClick(key1, t0.Add(2*time.Second)) {
		t.Errorf("User 1 click at t0+2s should be debounced")
	}

	// User 2 clicks again at t0 + 2s (ignored, only 1s after User 2's click)
	if debouncer.ShouldCountClick(key2, t0.Add(2*time.Second)) {
		t.Errorf("User 2 click at t0+2s should be debounced")
	}
}

func TestClickDebouncer_SameUserMultipleAds(t *testing.T) {
	debouncer := NewClickDebouncer()
	u := 200
	adA := 10
	adB := 20
	t0 := time.Now()

	keyA := getClickDebounceKey(&u, "", adA)
	keyB := getClickDebounceKey(&u, "", adB)

	// User clicks Ad A
	if !debouncer.ShouldCountClick(keyA, t0) {
		t.Errorf("Click on Ad A should be counted")
	}

	// User clicks Ad B 1s later: counted independently per ad
	if !debouncer.ShouldCountClick(keyB, t0.Add(1*time.Second)) {
		t.Errorf("Click on Ad B should be counted independently")
	}

	// User clicks Ad A again 2s later: debounced
	if debouncer.ShouldCountClick(keyA, t0.Add(2*time.Second)) {
		t.Errorf("Repeat click on Ad A at 2s should be debounced")
	}
}

func TestClickDebouncer_AnonymousIPFallback(t *testing.T) {
	debouncer := NewClickDebouncer()
	ip1 := "192.168.1.100"
	ip2 := "10.0.0.1"
	adID := 77
	t0 := time.Now()

	key1 := getClickDebounceKey(nil, ip1, adID)
	key2 := getClickDebounceKey(nil, ip2, adID)

	if key1 != "ip:192.168.1.100:ad:77" {
		t.Errorf("unexpected debounce key for IP: %s", key1)
	}

	// Anonymous IP 1 clicks
	if !debouncer.ShouldCountClick(key1, t0) {
		t.Errorf("initial click from IP 1 should be counted")
	}

	// Repeat click from IP 1 within 5s is debounced
	if debouncer.ShouldCountClick(key1, t0.Add(2*time.Second)) {
		t.Errorf("repeat click from IP 1 should be debounced")
	}

	// IP 2 clicks: independent
	if !debouncer.ShouldCountClick(key2, t0.Add(2*time.Second)) {
		t.Errorf("click from IP 2 should be counted")
	}
}

func TestAdsServiceImpl_ShouldDebounceClick(t *testing.T) {
	svc := &adsServiceImpl{
		clickDebouncer: NewClickDebouncer(),
	}
	ctx := context.Background()
	u := 777
	adID := 999
	t0 := time.Now()

	// 1st click: should NOT be debounced (i.e. shouldDebounceClick = false -> counted)
	if svc.shouldDebounceClick(ctx, &u, "", adID, t0) {
		t.Errorf("1st click should not be debounced")
	}

	// 2nd click 2 seconds later: should be debounced (shouldDebounceClick = true -> ignored)
	if !svc.shouldDebounceClick(ctx, &u, "", adID, t0.Add(2*time.Second)) {
		t.Errorf("2nd click at +2s should be debounced")
	}

	// 3rd click 5.5 seconds later: should NOT be debounced (counted)
	if svc.shouldDebounceClick(ctx, &u, "", adID, t0.Add(5500*time.Millisecond)) {
		t.Errorf("click at +5.5s should not be debounced")
	}
}
