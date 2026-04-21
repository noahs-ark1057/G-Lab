# G-Lab 公開メモ

## 1. いま入っているもの

- `/.github/workflows/deploy-pages.yml`
  - `main` へ push されるたびに GitHub Pages へ公開
- `/.github/workflows/daily-card-db.yml`
  - 毎日 `0:00 JST` に公式カードDBと画像キャッシュを更新
- `index.html` と `robots.txt`
  - `noindex / nofollow` 済み

## 2. いちばん簡単な公開手順

### GitHub リポジトリを作る

1. GitHub で新しいリポジトリを作る  
   例: `g-lab`
2. このフォルダで以下を実行する

```powershell
git init
git branch -M main
git add .
git commit -m "Initial G-Lab site"
git remote add origin https://github.com/<YOUR_NAME>/g-lab.git
git push -u origin main
```

### GitHub 側で有効化する

1. `Settings > Pages`
   - `Build and deployment` は `GitHub Actions`
2. `Settings > Actions > General`
   - `Workflow permissions` を `Read and write permissions` にする

これで次の2本が動く

- `Deploy G-Lab Site`
  - サイト公開
- `Daily Gundam Card DB Refresh`
  - 毎日 `0:00 JST` 更新

## 3. 公開URL

GitHub Pages の標準URLは次になる

```text
https://<YOUR_NAME>.github.io/g-lab/
```

これは正式公開URLとして使える。

## 4. もっと短いURLにする方法

### 4-1. `g-lab.pages.dev` 系にする

Cloudflare Pages で GitHub リポジトリを接続すると、  
プロジェクト名が空いていれば次のようなURLにできる。

```text
https://g-lab.pages.dev
```

### 4-2. `G-Lab.com` で始める

これは独自ドメインが必要。

必要なもの:

- `g-lab.com` か近いドメインを購入
- DNS を GitHub Pages か Cloudflare Pages に向ける

例:

- `https://g-lab.com`
- `https://www.g-lab.com`
- `https://app.g-lab.com`

## 5. 重要な注意

### AI診断

`艦長一言診断 / 大佐一言診断` はブラウザ内だけで動く。  
公開後もそのまま使える。

### DB自動更新

これは静的サイト単体ではなく、GitHub Actions が更新している。  
つまり「公開ページだけ」では動かず、GitHub リポジトリ上の workflow が必要。

## 6. 友人共有だけ先にやるなら

最短は GitHub Pages。  
短いURLまで欲しいなら、その次に Cloudflare Pages か独自ドメイン設定を足すのがきれい。
