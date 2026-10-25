# NEED TO KNOW

説明されない実験に送り込まれ、観察と推理で生存手順を組み立てるサバイバルホラーの企画およびMVP実装です。

現在の実装は、4モデルが並行して作った試作を1本に整理した**統合プロトタイプ**です。土台はAntigravity版（7日間MVP・異常4種）で、他3本からは実験中保存、保存障害の保護、ブラウザ検証を移植しました。人によるプレイテストは未実施で、仕様案の採択や受入完了を意味しません。経緯は[統合メモ](docs/implementation/統合メモ.md)と[ブランチ比較](docs/implementation/ブランチ比較.md)にあります。

## クイックスタート（統合プロトタイプ）

```bash
# 依存パッケージのインストール
npm install

# 開発サーバーの起動（ブラウザでプレイ）
npm run dev

# 本番ビルド（型チェック＋Viteビルド）
npm run build

# 受入条件（AC01〜AC15）と保存障害の自動テスト
npm test

# 任意: Playwrightがある環境でのブラウザ検証
npm run test:browser
```

`test:browser` はPlaywrightを依存に含めていない。既存の `playwright` / `playwright-core` を使う場合は `PLAYWRIGHT_MODULE` を、Chromiumの実体を指定する場合は `BROWSER_EXECUTABLE` を設定する。確認項目はタイトル→朝→T-101開始、移動、実験中保存、再読み込み復元、再開、前兆→停止解除、破損保存保護、390px幅、200%文字、コンソール例外・外部要求0件。

## 操作

| 入力 | 動作 |
| --- | --- |
| W A S D / 矢印 | 移動 |
| Shift（保持） | 走行 |
| Alt（保持）/ C（切替） | 低速歩行 |
| E / F | 調べる・回収する（画面のボタンでも可） |
| マウス | 視線の向き（速度は変わらない） |
| 1〜4 | インターホンへの返答 |
| N | 携帯ノート（実験時計を止める） |
| P / Esc | 設定・ポーズ |

実験中は2秒ごとに自動保存し、再読み込みすると一時停止状態で復元する。「実験を再開」で続きから再開できる。

## 実装構成

[MVP仕様案](docs/design/NEED_TO_KNOW_MVP仕様案.md)および[設計レビュー](docs/design/NEED_TO_KNOW_レビュー.md)の指摘（R01〜R13）と機能受入条件（AC01〜AC15）に基づき、エンジン非依存の純粋シミュレーション層と2D視界コーン＋Web Audio＋臨床端末UI層を分離して実装しています。

| ファイル | 役割 |
| --- | --- |
| `src/core/types.ts` | 第9節の分離レコード（`FacilityCycle`, `Subject`, `Trial`, `DeferredEvent`, `ReportArchive`）および型定義 |
| `src/core/rng.ts` | ルール抽選用Seed乱数と演出用乱数の分離、初回固定Seed（`FIXED-DEFAULT`）定義 |
| `src/core/content.ts` | 7日間の固定割当表、4名の同房者脚本、観測・伝聞定義、担当官A/B、事後聴取選択肢、終了分岐4種 |
| `src/core/trials.ts` | `T-101`（歩調）、`T-204`（名札）、`T-309`（白い扉）の状態機械・空間判定・同時判定優先順 |
| `src/core/engine.ts` | 7日間ループ、死亡交代と封筒継承、記憶処理（`S=3 → S=1`）、`W-00`（給水器）遅効比較面接、終了判定優先表 |
| `src/core/storage.ts` | セーブ／ロード、実験中断時のポーズ復元（AC03）、破損データ保護と自動上書き防止（AC15）、保存容量エラーの保護 |
| `src/audio/soundEngine.ts` | Web Audio API による手続き型音響生成（半拍遅れの追従足音、急接近前兆、金属脈動音、インターホン音）と前兆優先ダッキング |
| `src/render/canvasRenderer.ts` | 見下ろし2D＋視界コーン（扇形視野）、視界外の音紋（音響フィードバック）、監視カメラ稼働表示、青色非常灯固定点の描画 |
| `src/ui/app.ts` | 収容区画端末UI、携帯推理ノート（観測・伝聞・仮説）、寝台下の封筒、プレイヤー向け事後報告履歴、実験中保存と再開 |
| `tests/mvp-acceptance.test.ts` | 受入条件 AC01〜AC15 と保存障害の自動テスト |
| `tools/browser-smoke.mjs` | 任意のPlaywrightによるブラウザ検証 |

## 統合の記録

| 資料 | 内容 |
| --- | --- |
| [統合メモ](docs/implementation/統合メモ.md) | 土台の選定、他3本から移植した内容、統合時の修正、検証結果、未検証項目 |
| [ブランチ比較](docs/implementation/ブランチ比較.md) | 4実装の範囲・テスト・採用判断の比較 |

## 設計資料

| 資料 | 内容 |
| --- | --- |
| [原設計書](docs/design/NEED_TO_KNOW_ゲーム設計書.md) | 2026-10-25の企画原案。内容を変更せず収録 |
| [設計レビュー](docs/design/NEED_TO_KNOW_レビュー.md) | 指摘13件、優先順位、変更の代償、ライセンス記述の照合 |
| [MVP仕様案](docs/design/NEED_TO_KNOW_MVP仕様案.md) | 異常4種の判定、7日間の日程、保存、受入条件15項目 |
| [継承図](docs/design/NEED_TO_KNOW_継承図.html) | 死亡・記憶処理・新サイクルで保持する情報を比較する説明図 |

## 出典とライセンス

設計文書と継承図は、SCP財団に由来する設定を含む資料として[CC BY-SA 3.0](LICENSE.md)で公開します。[帰属表示](ATTRIBUTION.md)を参照してください。試作の実装コードを含むゲーム実装全体のライセンスは未決です。
