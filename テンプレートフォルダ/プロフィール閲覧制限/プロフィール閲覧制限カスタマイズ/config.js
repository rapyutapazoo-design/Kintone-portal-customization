/**
 * プロフィール閲覧制限カスタマイズ / config.js
 *
 * ★ 設定変更が必要なのはこのファイルだけです ★
 * 許可する組織・グループを変更する場合はこのファイルを編集し、
 * Kintone全体カスタマイズ画面で差し替えてください。
 */
window.ProfileRestrictionSettings = {

  // 設定・ロジックを変更したらこの番号を上げてください。
  // 古い許可判定キャッシュ（localStorage）が自動的に無効化されます。
  version: 2,

  // 許可する組織（コードまたは名前のどちらでも一致します）
  allowedOrgs: ['YOUR_ORG_CODE'],

  // 許可するグループ（コードまたは名前のどちらでも一致します）
  allowedGroups: ['YOUR_GROUP_CODE'],

  // 閲覧権限がないユーザーに表示するメッセージ
  blockMessage: 'このプロフィールは閲覧できません。',
};
