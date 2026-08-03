# テストスイートの実行方法

## 準備(初回のみ)
```
npm install -g playwright
npx playwright install chromium
```

## 実行
```
cd tests
node test_suite.js
```

`tests/`フォルダと同じ階層にある`生活リズム帳_修正版(最新).html`を自動でNode標準の
`http`モジュールで配信し、Playwrightでブラウザを起動してテストします。
外部のテストフレームワーク(Jest等)やビルドツールは使用していません。

## 構成
- **Unit**: escapeHtml・validateImportEntry(バックアップ検証)・日付処理・URL生成など、
  副作用のない関数のテスト
- **Integration**: localStorage / IndexedDB への保存→読込の往復、バックアップの
  export→import往復
- **境界値**: TODO 0件/1件/上限値、写真0枚、文字数0/極端に長い文字列、年末年始・
  うるう年などの日付境界
- **E2E**: 初回起動〜データ入力〜保存〜日付変更〜TODO操作〜写真追加削除〜
  バックアップ〜設定変更という一連の実際の利用フロー
- **回帰防止**: このアプリの品質監査で発見・修正した不具合(XSS・バックアップ検証・
  起動フリーズ・TODO描画のレイアウトスラッシング・キーボード操作・ARIA属性・
  コントラスト比・ObjectURLメモリリーク)が再発しないことを固定的に検証するテスト

## 実行結果の見方
最後に `合計: N件 / 成功: N件 / 失敗: N件 / 実行時間: Nms` が出力されます。
1件でも失敗があれば、終了コードが1になります(CI等での自動判定に利用可能)。

## 対象外(意図的に含めていないもの)
- `entitlement.js` / `purchase-journal.js` はテスト対象・変更対象のいずれからも除外しています
- localStorageの容量超過(QuotaExceededError)や、ブラウザの権限拒否といった、
  実行環境そのものを壊す必要がある異常系は、Playwrightでの安定した再現が難しいため
  今回は自動テスト化を見送りました(本文の報告で詳細を説明しています)
