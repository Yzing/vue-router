/* @flow */

import { install } from './install'
import { START } from './util/route'
import { assert } from './util/warn'
import { inBrowser } from './util/dom'
import { cleanPath } from './util/path'
import { createMatcher } from './create-matcher'
import { normalizeLocation } from './util/location'
import { supportsPushState } from './util/push-state'

import { HashHistory } from './history/hash'
import { HTML5History } from './history/html5'
import { AbstractHistory } from './history/abstract'

import type { Matcher } from './create-matcher'

/**
 * VueRouter
 * 实例属性：
 * 1、app 主挂载实例
 * 2、apps 所有挂载的实例
 * 3、options new VueRouter 时的配置
 * 4、beforeHooks、resolveHooks、afterHooks 全局钩子
 * 5、matcher 路由解析的对象
 *    match() 将路径解析为一个 route 对象
 *    addRoutes() 动态添加路由配置
 * 6、mode 路由模式，控制 history 的类型
 * 7、history 控制路由跳转的核心对象，有三个子类 [ HashHistory, HtmlHistory, AbstractHistory ]
 *
 * Tip1:
 *  router 的大部分方法都代理到 matcher 和 history 的相应方法上
 * Tip2:
 *  VueRouter 里的核心对象:
 *    Matcher 路由匹配器
 *    History 路由控制器
 *    Route 路由对象，封装了 RouteRecord
 *    RouteRecord 路由记录对象
 *    Location 内部 Location 对象
 */

export default class VueRouter {
  static install: () => void; // 插件注册静态方法
  static version: string;

  app: any; // 主挂载实例，即挂载的第一个 vue 实例
  apps: Array<any>; // 所有挂载了该路由的实例
  ready: boolean; // 标识路由是否解析成功
  readyCbs: Array<Function>; // 路由解析成功时的回调
  options: RouterOptions; // 路由配置
  mode: string; // 路由模式
  history: HashHistory | HTML5History | AbstractHistory; // History 对象，由路由模式决定
  matcher: Matcher; // 匹配器对象，用于跳转路由时匹配
  fallback: boolean; // ？
  beforeHooks: Array<?NavigationGuard>; // 全局 before 钩子
  resolveHooks: Array<?NavigationGuard>; // 全局 resolve 钩子
  afterHooks: Array<?AfterNavigationHook>; // 全局 after 钩子

  constructor (options: RouterOptions = {}) {

    // 初始化属性
    this.app = null
    this.apps = []
    this.options = options
    this.beforeHooks = []
    this.resolveHooks = []
    this.afterHooks = []
    this.matcher = createMatcher(options.routes || [], this)

    // 默认 hash 模式
    let mode = options.mode || 'hash'
    this.fallback = mode === 'history' && !supportsPushState && options.fallback !== false
    if (this.fallback) {
      mode = 'hash'
    }

    // 非浏览器下采用抽象模式
    if (!inBrowser) {
      mode = 'abstract'
    }
    this.mode = mode

    // 根据不同的路由模式生成不同的 History 对象
    switch (mode) {
      case 'history':
        this.history = new HTML5History(this, options.base)
        break
      case 'hash':
        this.history = new HashHistory(this, options.base, this.fallback)
        break
      case 'abstract':
        this.history = new AbstractHistory(this, options.base)
        break
      default:
        if (process.env.NODE_ENV !== 'production') {
          assert(false, `invalid mode: ${mode}`)
        }
    }
  }

  // 由内部对象 macher.match 代理
  match (
    raw: RawLocation,
    current?: Route,
    redirectedFrom?: Location
  ): Route {
    return this.matcher.match(raw, current, redirectedFrom)
  }

  // 定位到 history 对象的 current
  get currentRoute (): ?Route {
    return this.history && this.history.current
  }

  // 在 new Vue 实例时被调用
  init (app: any /* Vue component instance */) {
    process.env.NODE_ENV !== 'production' && assert(
      install.installed,
      `not installed. Make sure to call \`Vue.use(VueRouter)\` ` +
      `before creating root instance.`
    )

    this.apps.push(app)

    // main app already initialized.
    if (this.app) {
      return
    }

    this.app = app

    const history = this.history

    if (history instanceof HTML5History) {
      history.transitionTo(history.getCurrentLocation())
    } else if (history instanceof HashHistory) {
      const setupHashListener = () => {
        history.setupListeners()
      }
      history.transitionTo(
        history.getCurrentLocation(),
        setupHashListener,
        setupHashListener
      )
    }

    history.listen(route => {
      this.apps.forEach((app) => {
        app._route = route
      })
    })
  }

  beforeEach (fn: Function): Function {
    return registerHook(this.beforeHooks, fn)
  }

  beforeResolve (fn: Function): Function {
    return registerHook(this.resolveHooks, fn)
  }

  afterEach (fn: Function): Function {
    return registerHook(this.afterHooks, fn)
  }

  onReady (cb: Function, errorCb?: Function) {
    this.history.onReady(cb, errorCb)
  }

  onError (errorCb: Function) {
    this.history.onError(errorCb)
  }

  push (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    this.history.push(location, onComplete, onAbort)
  }

  replace (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    this.history.replace(location, onComplete, onAbort)
  }

  go (n: number) {
    this.history.go(n)
  }

  back () {
    this.go(-1)
  }

  forward () {
    this.go(1)
  }

  // 获取匹配的组件，先构造 route 对象，然后从 route.matched 中获取
  getMatchedComponents (to?: RawLocation | Route): Array<any> {
    const route: any = to
      ? to.matched
        ? to
        : this.resolve(to).route
      : this.currentRoute
    if (!route) {
      return []
    }
    return [].concat.apply([], route.matched.map(m => {
      return Object.keys(m.components).map(key => {
        return m.components[key]
      })
    }))
  }

  // 解析路径，返回 location、route、href 等对象
  resolve (
    to: RawLocation,
    current?: Route,
    append?: boolean
  ): {
    location: Location,
    route: Route,
    href: string,
    // for backwards compat
    normalizedTo: Location,
    resolved: Route
  } {
    // 解析 location
    const location = normalizeLocation(
      to,
      current || this.history.current,
      append,
      this
    )
    // 构造 route 对象
    const route = this.match(location, current)
    const fullPath = route.redirectedFrom || route.fullPath
    const base = this.history.base
    const href = createHref(base, fullPath, this.mode)
    return {
      location,
      route,
      href,
      // for backwards compat
      normalizedTo: location,
      resolved: route
    }
  }

  addRoutes (routes: Array<RouteConfig>) {
    this.matcher.addRoutes(routes)
    // 配置完路由后会重新进入当前路径
    if (this.history.current !== START) {
      this.history.transitionTo(this.history.getCurrentLocation())
    }
  }
}

// 注册钩子函数，返回一个删除该钩子的函数
function registerHook (list: Array<any>, fn: Function): Function {
  list.push(fn)
  return () => {
    const i = list.indexOf(fn)
    if (i > -1) list.splice(i, 1)
  }
}

// 返回完整 url 路径，不带 query
function createHref (base: string, fullPath: string, mode) {
  var path = mode === 'hash' ? '#' + fullPath : fullPath
  return base ? cleanPath(base + '/' + path) : path
}

VueRouter.install = install
VueRouter.version = '__VERSION__'

if (inBrowser && window.Vue) {
  window.Vue.use(VueRouter)
}
