# NEED TO KNOW

説明されない実験に送り込まれ、観察と推理で生存手順を組み立てるサバイバルホラーの企画およびMVP実装です。

## クイックスタート（MVP実装）

```bash
# 依存パッケージのインストール
npm install

# 開発サーバーの起動（ブラウザでプレイ）
npm run dev

# 本番ビルド（型チェック＋Viteビルド）
npm run build

# 受入条件（AC01〜AC15）自動テストの実行
npm test
```

## 実装構成

[MVP仕様案](docs/design/NEED_TO_KNOW_MVP仕様案.md)および[設計レビュー](docs/design/NEED_TO_KNOW_レビュー.md)の指摘（R01〜R13）と機能受入条件（AC01〜AC15）に基づき、エンジン非依存の純粋シミュレーション層と2D視界コーン＋Web Audio＋臨床端末UI層を分離して実装しています。

| ファイル | 役割 |
| --- | --- |
| `src/core/types.ts` | 第9節の分離レコード（`FacilityCycle`, `Subject`, `Trial`, `DeferredEvent`, `ReportArchive`）および型定義 |
| `src/core/rng.ts` | ルール抽選用Seed乱数と演出用乱数の分離、初回固定Seed（`FIXED-DEFAULT`）定義 |
| `src/core/content.ts` | 7日間の固定割当表、4名の同房者脚本、観測・伝聞定義、担当官A/B、事後聴取選択肢、終了分岐4種 |
| `src/core/trials.ts` | `T-101`（歩調）、`T-204`（名札）、`T-309`（白い扉）の状態機械・空間判定・同時判定優先順 |
| `src/core/engine.ts` | 7日間ループ、死亡交代と封筒継承、記憶処理（`S=3 → S=1`）、`W-00`（給水器）遅効比較面接、終了判定優先表 |
| `src/core/storage.ts` | セーブ／ロード、実験中断時のポーズ復元（AC03）、破損データ保護と自動上書き防止（AC15） |
| `src/audio/soundEngine.ts` | Web Audio API による手続き型音響生成（半拍遅れの追従足音、急接近前兆、金属脈動音、インターホン音）と前兆優先ダッキング |
| `src/render/canvasRenderer.ts` | 見下ろし2D＋視界コーン（扇形視野）、視界外の音紋（音響フィードバック）、監視カメラ稼働表示、青色非常灯固定点の描画 |
| `src/ui/app.ts` | 収容区画端末UI、携帯推理ノート（観測・伝聞・仮説）、寝台下の封筒、プレイヤー向け事後報告履歴 |
| `tests/mvp-acceptance.test.ts` | 受入条件 AC01〜AC15 を検証する自動テストスイート |

## 設計資料

| 資料 | 内容 |
| --- | --- |
| [原設計書](docs/design/NEED_TO_KNOW_ゲーム設計書.md) | 2026-10-25の企画原案。内容を変更せず収録 |
| [設計レビュー](docs/design/NEED_TO_KNOW_レビュー.md) | 指摘13件、優先順位、変更の代償、ライセンス記述の照合 |
| [MVP仕様案](docs/design/NEED_TO_KNOW_MVP仕様案.md) | 異常4種の判定、7間の日程、保存、受入条件15項目 |
| [継承図](docs/design/NEED_TO_KNOW_継承図.html) | 死亡・記憶処理・新サイクルで保持する情報を比較する説明図 |

## 出典とライセンス

設計文書と継承図は、SCP財団に由来する設定を含む資料として[CC BY-SA 3.0](LICENSE.md)で公開します。[帰属表示](ATTRIBUTION.md)を参照してください。
