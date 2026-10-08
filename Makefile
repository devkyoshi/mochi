.PHONY: dev install web build test lint typecheck check rust-test

# Run the desktop app (Tauri + Vite); installs deps first if missing
dev: node_modules
	npm run tauri dev

node_modules: package-lock.json
	npm install
	@touch node_modules

install:
	npm install

# Frontend only, in the browser (no Tauri APIs)
web: node_modules
	npm run dev

build: node_modules
	npm run tauri build

test: node_modules
	npm test

lint: node_modules
	npm run lint

typecheck: node_modules
	npm run typecheck

rust-test:
	cd src-tauri && cargo test

# Everything that must be green before a commit
check: test lint typecheck rust-test
