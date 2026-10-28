/* Confirm that an exported backup was actually saved before hiding reminders. */
(function (root) {
  'use strict';
  async function confirmSaved(mode, includesMedia, mediaNote) {
    var next = mode === 'share' ? '请在分享面板中保存文件，或发送到你自己的安全位置。' :
      mode === 'clipboard' ? '请先把剪贴板内容粘贴并保存成备份文件。' : '请确认下载的备份文件已保存到安全位置。';
    var coverage = includesMedia ? '这次选择包含附件；请检查导出结果。' : '文字备份不包含照片、语音和视频。';
    var detail = mediaNote ? '<p>' + root.U.esc(mediaNote) + '</p>' : '';
    var saved = await root.UX.confirm({icon:'package', title:'确认备份已保存',
      html: '<p>' + next + '</p><p>' + coverage + '</p>' + detail,
      ok:'已经保存', cancel:'稍后处理'});
    if (saved) root.Store.commit(function (data) { data.settings.lastBackupAt = Date.now(); });
    return !!saved;
  }
  root.BackupReceipt = { confirmSaved: confirmSaved };
})(window);
