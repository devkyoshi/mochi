.PHONY: help dev stop install web build installer hook test lint typecheck rust-test check clean

# `make` with no target shows this list.
help:
	@echo "make dev        Run the desktop app (first run compiles for a few minutes)"
	@echo "make stop       Stop the app and any leftover dev server on port 1420"
	@echo "make web        Frontend only, in a browser (no Tauri features)"
	@echo "make check      Everything that must be green before a commit"
	@echo "make test       Frontend tests (vitest)"
	@echo "make rust-test  Rust tests"
	@echo "make lint       ESLint"
	@echo "make typecheck  TypeScript"
	@echo "make build      Release build + installer for this OS"
	@echo "make hook       Build the Claude Code hook helper (sidecar)"
	@echo "make clean      Remove build output (frontend dist and Rust target)"

# Run the desktop app (Tauri + Vite). Installs dependencies if needed and first frees port 1420,
# which a dev server from an earlier run keeps holding after the window is closed.
dev: node_modules/.stamp
	@echo ""
	@echo "Starting Mochi. Look at the TOP-CENTER of your screen for the small pill with the blob."
	@echo "Click it, or press Ctrl+Shift+Space, to open the panel. Esc closes it. Stop with Ctrl+C or 'make stop'."
	@echo ""
	node scripts/free-port.mjs 1420
	npm run tauri dev

# Stop the app and the dev server it leaves behind.
stop:
	-node -e "const {execFileSync:e}=require('child_process');try{process.platform==='win32'?e('taskkill',['/F','/IM','mochi.exe'],{stdio:'ignore'}):e('pkill',['-x','mochi'],{stdio:'ignore'})}catch{}"
	node scripts/free-port.mjs 1420

# Install npm packages when package.json / package-lock.json change.
node_modules/.stamp: package.json package-lock.json
	npm install
	node -e "require('fs').mkdirSync('node_modules',{recursive:true});require('fs').writeFileSync('node_modules/.stamp','')"

install:
	npm install

# Frontend only, in the browser (Tauri-only features such as files and Claude do not work)
web: node_modules/.stamp
	node scripts/free-port.mjs 1420
	npm run dev

build: node_modules/.stamp
	npm run tauri build

installer: build

hook: node_modules/.stamp
	npm run prepare:hook

test: node_modules/.stamp
	npm test

lint: node_modules/.stamp
	npm run lint

typecheck: node_modules/.stamp
	npm run typecheck

rust-test:
	cd src-tauri && cargo test

# Everything that must be green before a commit
check: test lint typecheck rust-test

clean:
	node -e "const fs=require('fs');for(const p of ['dist','src-tauri/target','src-tauri/binaries'])fs.rmSync(p,{recursive:true,force:true})"
