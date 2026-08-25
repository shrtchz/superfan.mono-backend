package labels

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type data struct {
	Wallet  map[string]string `json:"wallet"`
	Methods map[string]string `json:"methods"`
}

var (
	loaded   data
	loadOnce sync.Once
)

func load() {
	loadOnce.Do(func() {
		candidates := []string{
			filepath.Join(".", "lables.data.json"),
			filepath.Join("..", "lables.data.json"),
			filepath.Join("/app", "lables.data.json"),
			filepath.Join("/root", "lables.data.json"),
		}

		var contents []byte
		var err error
		for _, path := range candidates {
			contents, err = os.ReadFile(path)
			if err == nil {
				break
			}
		}
		if err != nil {
			panic("lables.data.json could not be found")
		}
		if err := json.Unmarshal(contents, &loaded); err != nil {
			panic("lables.data.json is invalid")
		}
	})
}

func render(template string, values map[string]string) string {
	for key, value := range values {
		template = strings.ReplaceAll(template, "{{"+key+"}}", value)
		template = strings.ReplaceAll(template, "{{ "+key+" }}", value)
	}
	return template
}

func Wallet(key string, values map[string]string) string {
	load()
	return render(loaded.Wallet[key], values)
}

func Method(key string) string {
	load()
	return loaded.Methods[key]
}
