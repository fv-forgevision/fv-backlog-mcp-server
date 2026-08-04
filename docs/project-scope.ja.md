# プロジェクトスコープ制限

English: [project-scope.md](project-scope.md)

このフォークは、MCP サーバーが触れる Backlog プロジェクトを明示的な許可リストに限定する機能を追加しています。上流（nulab/backlog-mcp-server）ではエージェントがスペース内の全プロジェクトを横断して読み書きできますが、本機能を有効にすると許可リスト外のプロジェクトへの参照はすべて拒否されます。

## これはセキュリティ境界ではありません

先に前提を明確にします。

**この機能はエージェントの誤操作を防ぐガードであって、セキュリティ境界ではありません。** APIキーにせよ OAuth トークンにせよ、認証情報の権限は Backlog アカウントの権限そのままでスペース全体に及びます。`curl` などで Backlog API を直接叩ける人には何の制約にもなりません。

技術的な境界が必要な場合は、**対象プロジェクトにのみ参加している Backlog アカウントを作り、そのアカウントの APIキー（または OAuth 認可）を使ってください。** 本機能はその上に重ねる二重の防御として位置づけるのが適切です。

## 設定

環境変数またはコマンドライン引数で、許可するプロジェクトキーをカンマ区切りで指定します。

| 指定方法 | 例 |
|---|---|
| 環境変数 | `BACKLOG_ALLOWED_PROJECTS=PBL,INFRA` |
| CLI 引数 | `--allowed-projects "PBL,INFRA"` |

- 大文字小文字は区別しません（内部で大文字に正規化されます）
- 未設定または空文字の場合、上流と同じ無制限動作になります
- プロジェクトキーであり、プロジェクト名やIDではありません（`PBL-123` の `PBL` の部分）

設定例（Claude Desktop 等）:

```json
{
  "mcpServers": {
    "backlog": {
      "command": "npx",
      "args": ["-y", "backlog-mcp-server"],
      "env": {
        "BACKLOG_DOMAIN": "your-space.backlog.jp",
        "BACKLOG_API_KEY": "your-api-key",
        "BACKLOG_ALLOWED_PROJECTS": "PBL,INFRA"
      }
    }
  }
}
```

## 有効時の挙動

### 1. プロジェクトを引数に取るツール

`projectId` / `projectKey` / `projectIdOrKey` が許可リストに含まれるかを実行前に検証します。含まれない場合はツールを実行せずに拒否します。

許可プロジェクトがちょうど1つの場合、プロジェクト引数が省略されていれば自動的に補完します。複数許可している場合は、どのプロジェクトかを明示するよう促すエラーを返します。

### 2. プロジェクトを絞り込めるが必須ではないツール

`get_issues` / `count_issues` の `projectId`、`get_documents` の `projectIds` は省略可能なフィルタです。省略された場合はスペース全体が対象になってしまうため、**許可プロジェクトのIDを自動的に注入**します。指定されている場合は全要素を検証します。

### 3. 課題・Wiki・ドキュメントIDで間接指定するツール

`get_issue` や `update_wiki` のようにプロジェクトを引数に持たないツールは、対象エンティティの所属プロジェクトを解決してから検証します。

課題キー（`PBL-123`）の場合はキーのプレフィックスがプロジェクトキーそのものなので、**API を呼ばずに判定**します。数値IDの場合のみ1回 API で解決し、結果をキャッシュします。

`update_issue` の `parentIssueId`、`add_related_issue` の `targetIssueId` のような二つ目の課題も同様に検証します。

### 4. 出力のフィルタ

`get_project_list` はプロジェクト引数を取らないため、レスポンスから許可リスト外のプロジェクトを除去します。

### 5. 登録されないツール（18個）

プロジェクト単位に絞り込む手段が API に存在しないツールは、そもそもツール一覧に登録されません。エージェントからは存在しないものとして扱われます。

| 分類 | ツール |
|---|---|
| 通知 | `get_notifications`, `count_notifications`, `mark_notification_as_read`, `reset_unread_notification_count` |
| ウォッチ | `get_watching_list_items`, `get_watching_list_count`, `add_watching`, `update_watching`, `delete_watching`, `mark_watching_as_read` |
| スペース | `get_space`, `get_space_activities`, `get_users`, `get_user_stars_count`, `get_user_recent_updates` |
| プロジェクト管理 | `add_project`, `update_project`, `delete_project` |

`update_project` を含めているのは、**プロジェクトキーを変更できてしまうと許可リストの前提そのものが崩れる**ためです。

結果として、全ツールセットを有効にした場合のツール数は 62 → 44 になります。

### 6. 分類されていないツールは自動的にブロック

`src/scope/toolScopePolicy.ts` の表に存在しないツール名は、既定でブロックされます。上流の更新でツールが追加された場合、分類されるまでは登録されません（fail-safe）。

この表と実際のツール一覧の突き合わせは `src/scope/toolScopePolicy.test.ts` が検証しており、ツールが増減すればテストが落ちて気づけるようになっています。

## 実装の構造

```
src/scope/
  projectScope.ts        設定のパース、ProjectScopeError
  projectResolver.ts     プロジェクトキー⇔ID の解決、課題/Wiki/文書→プロジェクトの解決とキャッシュ
  toolScopePolicy.ts     ツール名→適用ルールの表（deny by default）
  wrapWithProjectScope.ts ルールを入力・出力に適用するハンドララッパ
```

制約は `src/handlers/builders/composeToolHandler.ts` で全ツール共通に注入されます。個別のツール実装には一切手を入れていないため、上流の変更を取り込みやすい構成になっています。

ラッパは organization コンテキストの内側に位置します。複数スペース構成でも、解決処理が正しい Backlog クライアントを経由するためです。

## 制限事項

- **キャッシュ**: 課題・Wiki・ドキュメントの所属プロジェクトはプロセス内にキャッシュされます（上限5000件、超過時は全クリア）。所属が変わることはないため通常は問題になりませんが、長時間稼働するプロセスではメモリを一定量消費します。
- **存在の推測**: 許可外の課題IDを指定した場合、拒否メッセージから「その課題が存在すること」は推測できます。内容は一切返しません。
- **添付ファイル**: 添付ファイルIDによる操作は、現状プロジェクト単位の検証を行っていません（該当ツールは `add_issue` / `add_issue_comment` の `attachmentId` パラメータのみで、いずれも許可プロジェクト内の課題に対する操作です）。
