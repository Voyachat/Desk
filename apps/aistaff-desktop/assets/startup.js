const draft = document.querySelector('#draft')
const preset = document.querySelector('#preset')
const retry = document.querySelector('#retry')
const status = document.querySelector('.status')
const statusText = document.querySelector('#status-text')

function renderState(state) {
  const failed = state.phase === 'failed'
  status.classList.toggle('failed', failed)
  retry.hidden = !failed
  retry.disabled = state.phase === 'starting'
  statusText.textContent = failed
    ? `服务启动失败：${state.message}`
    : state.phase === 'ready'
      ? '服务已就绪，正在进入工作区'
      : '服务启动中，可继续编辑'
}

function saveIntent() {
  void window.voyaseekStartup.setIntent({
    draft: draft.value,
    agentPreset: preset.value,
  }).catch(() => {
    status.classList.add('failed')
    statusText.textContent = '暂时无法保存输入，请重试'
  })
}

draft.addEventListener('input', saveIntent)
preset.addEventListener('change', saveIntent)
retry.addEventListener('click', () => {
  retry.disabled = true
  void window.voyaseekStartup.retry().then(renderState).catch(() => {
    renderState({ phase: 'failed', message: '重试请求失败' })
  })
})

window.voyaseekStartup.onState(renderState)
void Promise.all([
  window.voyaseekStartup.getIntent(),
  window.voyaseekStartup.getState(),
]).then(([intent, state]) => {
  draft.value = intent?.draft ?? ''
  preset.value = intent?.agentPreset ?? 'standard'
  renderState(state)
  draft.focus()
}).catch(() => {
  renderState({ phase: 'failed', message: '启动状态不可用' })
})
