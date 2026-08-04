# リリースと公開の手順

このフォークの公開先と、リリース作業の手順をまとめます。

| 公開先 | 識別子 |
|---|---|
| GitHub リポジトリ | [fv-forgevision/fv-backlog-mcp-server](https://github.com/fv-forgevision/fv-backlog-mcp-server) |
| npm パッケージ | `@fyosimi/fv-backlog-mcp-server`（fyosimi アカウントのスコープ） |
| Docker イメージ | `ghcr.io/fv-forgevision/fv-backlog-mcp-server` |
| 実行コマンド名 | `fv-backlog-mcp-server` |

上流は [nulab/backlog-mcp-server](https://github.com/nulab/backlog-mcp-server)（MIT）です。本フォークは上流 v0.15.1 をベースに、独自のバージョン番号（0.1.0 から）で管理します。

## 初回公開の前に必要な準備

リリースワークフローを動かす前に、以下を1回だけ済ませておく必要があります。

### 1. npm のスコープと認証トークン

`@fyosimi` スコープは npm アカウント `fyosimi` に紐づきます。スコープ付きパッケージは既定で private 扱いになるため、`package.json` に `publishConfig.access: "public"` を設定済みです（これがないと無料アカウントでは publish が失敗します）。

自動リリース用のトークンを発行し、リポジトリに登録します。

1. https://www.npmjs.com/settings/fyosimi/tokens で **Automation** タイプのトークンを発行
   （Automation タイプは 2FA を要求しないため CI から使えます）
2. GitHub の `fv-forgevision/fv-backlog-mcp-server` → Settings → Secrets and variables → Actions
3. `NPM_TOKEN` という名前で登録

> リリースワークフローは `pnpm publish --provenance` を使います。provenance の付与には `id-token: write` 権限が必要ですが、これは `.github/workflows/release.yml` に設定済みです。

`release.yml` の `Publish to npm` ステップは、`setup-node` が生成する `.npmrc` 経由で `NODE_AUTH_TOKEN` としてこのシークレットを読むよう設定済みです。登録する名前を `NPM_TOKEN` から変える場合は、ワークフロー側も合わせて修正してください。

### 2. GitHub Actions の権限

Settings → Actions → General → Workflow permissions を **Read and write permissions** にしておきます。リリースワークフローがバージョン更新のコミット、タグ、GitHub Release の作成を行うためです。

### 3. GHCR（Docker イメージ）

`ghcr.io` への push は `secrets.GITHUB_TOKEN` で行うため、追加の認証設定は不要です。ただし初回 push で作られるパッケージは既定で private なので、公開したい場合は初回リリース後に GitHub のパッケージ設定から visibility を Public に変更してください。

**初回リリースを行うまで、README に記載した `docker pull ghcr.io/fv-forgevision/fv-backlog-mcp-server:latest` は失敗します。**

## リリース手順

1. main ブランチに変更をマージする
2. GitHub の Actions タブ → **Release** ワークフロー → **Run workflow**
3. `patch` / `minor` / `major` を選んで実行

ワークフローが自動で行うこと:

- ビルド
- `package.json` のバージョン更新
- Docker イメージのビルドと GHCR への push（`linux/amd64`, `linux/arm64`）
- npm への publish（同一バージョンが既に存在する場合はスキップ）
- バージョン更新のコミット、`vX.Y.Z` タグの作成、GitHub Release の作成

## 手動で publish する場合

CI を使わずに publish するときの手順です。

```bash
# 1. ローカルで検証
pnpm install --frozen-lockfile
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build

# 2. 中身の確認（実際に publish せず、含まれるファイルを表示）
npm pack --dry-run

# 3. npm にログイン（fyosimi アカウント）
npm login

# 4. publish
pnpm publish --access public
```

`package.json` の `files` は `["build"]` なので、公開されるのはビルド成果物と `package.json` / `README.md` / `LICENSE` のみです。ソースやテストは含まれません。

## 動作確認

publish 後、次のコマンドで実際に取得して起動できることを確認します。

```bash
npx -y @fyosimi/fv-backlog-mcp-server --help
```

MCP クライアントからの利用設定は [README.ja.md](../README.ja.md) を参照してください。

## 上流の変更を取り込む

上流は `upstream` リモートとして登録済みです。

```bash
git fetch upstream
git merge upstream/main
```

取り込み後は必ずテストを実行してください。とくに **`src/scope/toolScopePolicy.test.ts` が落ちた場合は、上流でツールが追加・削除されたことを意味します**。追加されたツールは分類されるまで自動的にブロックされる（fail-safe）ので、`src/scope/toolScopePolicy.ts` に適切なルールを追加してください。

競合しやすいのは以下のファイルです。それ以外の上流ファイルには手を入れていません。

- `src/registerTools.ts`
- `src/handlers/builders/composeToolHandler.ts`
- `src/index.ts`
- `src/types/mcp.ts`
- `src/backlog/parseBacklogAPIError.ts`
- `package.json` / `manifest.json` / `README*.md` / `.github/workflows/release.yml`（フォーク固有の名前を含むため）
