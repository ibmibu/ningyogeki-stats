# 人形劇 戦績表

Smashmateの「人形劇」シリーズを自動集計するNext.jsアプリです。

## データ取得の流れ

1. `https://smashmate.net/user_add_tournament/?user=81727` を取得
2. 大会名が `人形劇#数字` の大会だけ抽出
3. 各大会ページから「トーナメント表」の `/bracket/<id>/` を取得
4. bracket HTML の `.tour_div_in` / `.tour_user_box` / `data-uid` / `data-result` を解析
5. 全大会の直接対戦結果を合算

キャラクター情報は使用しません。

## 開発

```bash
npm install
npm run dev
```

ブラウザで http://localhost:3000 を開きます。

## 注意

Smashmate側のアクセス制限やHTML構造変更により取得できない場合があります。サイトへ過度なリクエストを送らないよう、同時取得数を3に制限しています。
