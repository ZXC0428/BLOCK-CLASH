# BLOCK CLASH

BLOCK CLASH 是一款以瀏覽器執行的方塊對戰遊戲，支援單人闖關、限時挑戰、無盡模式與雙人競技對戰。

玩家可以透過消除方塊行數取得分數與攻擊行，並使用 HOLD、連擊與垃圾行機制挑戰關卡或擊敗對手。

## 專案資訊

- **專案名稱：** BLOCK CLASH
- **遊戲類型：** 方塊益智、單人闖關、雙人競技
- **主要技術：** HTML、CSS、JavaScript、Node.js、SQLite
- **執行環境：** Node.js 22.5.0 以上
- **資料保存：** SQLite 與瀏覽器 Local Storage
- **介面語言：** 繁體中文

## 目前功能

### 單人模式

- 單人練習模式
- 10 個單人闖關關卡
- 60 秒衝刺模式
- 120 秒得分模式
- 無盡練習模式
- 不同關卡使用不同起始盤面
- 關卡目標與時間限制
- 關卡完成後取得 1～3 顆星
- 關卡依序解鎖
- 保存關卡最高星等與最佳分數

### 雙人對戰

- P1 與 P2 雙人競技
- `3、2、1、GO!` 開局倒數
- 先取得 2 次 KO 的玩家獲勝
- 消除多行時發送攻擊行
- 顯示攻擊、收到垃圾行與連擊提示
- 垃圾行推出含方塊的最上方列時立即判定 KO
- KO 動畫與音效
- 單局結果與雙方戰績摘要
- 保存雙人歷史勝場紀錄

### 方塊操作

- HOLD 方塊功能
- 每個方塊落下流程只能使用一次 HOLD
- NEXT 方塊預覽佇列
- 方塊落點預覽
- 旋轉、移動、加速下落與直接落下
- 多種起始地圖：
  - 經典競技場
  - 峽谷缺口
  - 兩側階梯
  - 雙塔迷陣
- 連擊與消行回饋
- 音效與背景音樂控制
- 響應式介面與觸控按鈕

## 操作方式

### 單人模式

| 操作 | 按鍵 |
| --- | --- |
| 左移 | `←` |
| 右移 | `→` |
| 加速下落 | `↓` |
| 旋轉 | `↑` |
| 直接落下 | `Space` |
| HOLD | `C` 或 `Q` |
| 暫停 | `P` |
| 重新設定 | `R` |

### 雙人模式

| 玩家 | 左移 | 右移 | 加速下落 | 旋轉 | 直接落下 | HOLD |
| --- | --- | --- | --- | --- | --- | --- |
| P1，右側 | `←` | `→` | `↓` | `↑` | `Enter` | `C` |
| P2，左側 | `A` | `D` | `S` | `W` | `Shift` | `Q` |

## 資料保存

專案會保存以下資料：

- 單人玩家名稱
- 單人關卡完成進度
- 每個關卡的最高星等
- 每個關卡的最佳分數
- 60 秒衝刺最佳成績
- 120 秒得分最佳成績
- 無盡模式最佳成績
- 雙人模式累積勝場

資料保存方式：

- 瀏覽器端使用 Local Storage 作為備援
- 啟動 Node.js 伺服器後，使用 SQLite 保存進度與排行榜資料
- SQLite 資料庫檔案會建立在專案根目錄的 `block-clash.sqlite`

## 啟動方式

### 系統需求

- Node.js 22.5.0 或更新版本
- npm

確認 Node.js 版本：

```bash
node --version
npm --version
```

### 安裝與啟動

下載專案後，在專案根目錄執行：

```bash
npm start
```

伺服器啟動後，使用瀏覽器開啟：

```text
http://localhost:3000
```

請使用 `npm start` 啟動，不建議直接雙擊 `index.html`，因為直接開啟檔案時無法使用 SQLite 進度保存、排行榜與伺服器 API。

## 專案結構

```text
.
├── index.html
├── game.js
├── style.css
├── server.js
├── package.json
├── tests/
│   ├── multiplayer-competition.test.js
│   └── multiplayer-competition.browser.test.js
└── block-clash.sqlite
```

## 測試

目前包含雙人對戰功能的自動化測試：

```bash
node --test tests/multiplayer-competition.test.js
```

瀏覽器測試需要 Playwright 與可用的 Chromium 或 Chrome 瀏覽器：

```bash
node --test tests/multiplayer-competition.browser.test.js
```

## GitHub Pages 注意事項

目前完整版本需要 `server.js` 提供：

- SQLite 資料保存
- 單人進度 API
- 排行榜 API
- 玩家資料 API

GitHub Pages 只能提供靜態檔案，無法執行 Node.js 伺服器或 SQLite。因此：

- GitHub Pages 可以展示靜態介面
- 但無法使用完整的進度保存與排行榜功能
- 完整遊戲建議使用 Node.js 伺服器啟動
- 若要部署到網路上，需要使用支援 Node.js 後端的服務

## 開發方向

- 增加更多單人關卡與特殊障礙
- 強化排行榜與玩家資料管理
- 增加線上多人對戰
- 完善雲端進度同步
- 補充完整的瀏覽器自動化測試

## 授權

目前尚未設定正式授權條款。
