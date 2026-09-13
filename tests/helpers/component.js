import { readFileSync } from 'node:fs'
import { parse, compileScript } from 'vue/compiler-sfc'
import * as vue from 'vue'

// 使用真实 Vue 响应式和生命周期测试组件逻辑；网络、布局和计时器由用例控制。
export function mountLogic(filename, modules = {}, props = {}) {
  const { descriptor } = parse(readFileSync(new URL(filename, import.meta.url), 'utf8'))
  let source = compileScript(descriptor, { id: 'regression' }).content
  source = source.replace(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g, (_, bindings, path) => {
    const target = bindings.trim().startsWith('{')
      ? bindings.replace(/\bas\b/g, ':')
      : `{ default: ${bindings.trim()} }`
    return `const ${target} = modules[${JSON.stringify(path)}];`
  }).replace('export default', 'return')
  const component = new Function('modules', source)({ vue, ...modules })
  const setup = component.setup
  let state
  component.setup = (props, context) => { state = setup(props, context); return state }
  component.render = () => null
  const renderer = vue.createRenderer({
    createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null,
    nextSibling: () => null, setText() {}, setElementText() {},
  })
  const app = renderer.createApp(component, props)
  app.mount({})
  return {
    state,
    setProps: values => Object.assign(app._instance.props, values),
    unmount: () => app.unmount(),
  }
}

export function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

export function browserStubs() {
  const timers = new Map()
  let timerId = 0
  globalThis.window = {
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id },
    clearTimeout(id) { timers.delete(id) },
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    innerHeight: 800,
  }
  globalThis.document = {
    documentElement: { style: { setProperty() {}, removeProperty() {} } },
  }
  return {
    timers,
    runTimers() {
      const pending = [...timers.values()]
      timers.clear()
      for (const callback of pending) callback()
    },
  }
}
