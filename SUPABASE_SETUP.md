# G-Lab Supabase セットアップ

`G-Lab` は `Supabase` を使って、次の情報をユーザーごとに同期できます。

- 保存デッキ
- お気に入り
- テーマ設定
- 参考デッキの読み込み履歴

ブラウザ単体ではなく、`Supabase プロジェクト + このリポジトリ` の組み合わせで動きます。

## 1. Supabase プロジェクトを作る

1. [Supabase](https://supabase.com/) で新しい project を作成する
2. `Project Settings > API` を開く
3. 次の 2 つを控える
   - `Project URL`
   - `anon public key`

## 2. 同期テーブルを作る

1. Supabase の `SQL Editor` を開く
2. [supabase/user_app_states.sql](</C:/Users/石田　かずき/Documents/Codex/2026-04-20-https-deck-maker-com/supabase/user_app_states.sql>) の内容を貼り付けて実行する

これで、ログイン中のユーザーだけが自分の保存データを読めるテーブルが作成されます。

## 3. メールログインを有効にする

1. `Authentication > Providers > Email` を開く
2. Email provider を有効にする
3. 必要なら確認メール設定も調整する

確認メール必須にした場合は、新規登録後にメール承認してからログインしてください。

## 4. フロント側に URL と key を入れる

[supabase-config.js](</C:/Users/石田　かずき/Documents/Codex/2026-04-20-https-deck-maker-com/supabase-config.js>) を開いて、`url` と `anonKey` を入れます。

```js
window.__GLAB_SUPABASE__ = {
  url: "https://YOUR_PROJECT.supabase.co",
  anonKey: "YOUR_SUPABASE_ANON_KEY",
  storageKey: "g-lab-supabase-session",
  table: "user_app_states",
};
```

注意:

- `anon public key` を使ってください
- `service_role key` は入れないでください

## 5. サイトで使う

1. サイトを開く
2. `保存` タブへ移動する
3. `クラウド同期` でメールアドレスとパスワードを入力する
4. `ログイン` か `新規登録` を押す

ログイン後は、次の内容が自動同期されます。

- 保存デッキ
- お気に入り
- テーマ設定
- 参考デッキの読み込み履歴

## 6. いまの構成でできること

- `Supabase` ベースでログイン可能
- ユーザーごとに 1 行の保存領域を持つ
- ローカル保存とサーバー保存を自動マージする
- 既存の `localStorage` 保存もそのまま併用できる

## 7. 補足

- いまの同期は `user_app_states` に 1 ユーザー 1 行で保存します
- ログアウトしても、端末内のローカル保存は残ります
- GitHub Actions のカードDB更新とは独立です

## 8. 関連ファイル

- [supabase-config.js](</C:/Users/石田　かずき/Documents/Codex/2026-04-20-https-deck-maker-com/supabase-config.js>)
- [supabase-cloud.js](</C:/Users/石田　かずき/Documents/Codex/2026-04-20-https-deck-maker-com/supabase-cloud.js>)
- [supabase/user_app_states.sql](</C:/Users/石田　かずき/Documents/Codex/2026-04-20-https-deck-maker-com/supabase/user_app_states.sql>)
