/* @flow */

/*
@class History
@description
  History 的基础实现，用来代理 Router 对象的页面跳转
@constructor
  (router: Router, base: ?string)
@methods
  abstract methods: 在具体模式中实现的方法
    go
    push
    replace
    ensureURL
    getCurrentLocation
  private methods: 提供给子类使用或是用于自身封装的方法
    transitionTo
    confirmTransition
    updateRoute
*/

import { _Vue } from '../install'
import type Router from '../index'
import { inBrowser } from '../util/dom'
import { runQueue } from '../util/async'
import { warn, isError } from '../util/warn'
import { START, isSameRoute } from '../util/route'
import {
  flatten,
  flatMapComponents,
  resolveAsyncComponents
} from '../util/resolve-components'

export class History {
  router: Router;
  base: string;
  current: Route;
  pending: ?Route;
  cb: (r: Route) => void;
  ready: boolean;
  readyCbs: Array<Function>;
  readyErrorCbs: Array<Function>;
  errorCbs: Array<Function>;

  // implemented by sub-classes
  +go: (n: number) => void;
  +push: (loc: RawLocation) => void;
  +replace: (loc: RawLocation) => void;
  +ensureURL: (push?: boolean) => void;
  +getCurrentLocation: () => string;

  constructor (router: Router, base: ?string) {
    this.router = router
    this.base = normalizeBase(base)
    // start with a route object that stands for "nowhere"
    this.current = START
    this.pending = null
    this.ready = false
    this.readyCbs = []
    this.readyErrorCbs = []
    this.errorCbs = []
  }

  listen (cb: Function) {
    this.cb = cb
  }

  onReady (cb: Function, errorCb: ?Function) {
    if (this.ready) {
      cb()
    } else {
      this.readyCbs.push(cb)
      if (errorCb) {
        this.readyErrorCbs.push(errorCb)
      }
    }
  }

  onError (errorCb: Function) {
    this.errorCbs.push(errorCb)
  }

  /**
   * [transitionTo 路由跳转方法]
   * @param  {[type]} location   [将要转向的 location 对象]
   * @param  {[type]} onComplete [跳转完成后回调]
   * @param  {[type]} onAbort    [跳转取消后回调]
   * @return {[type]}            [null]
   */
  transitionTo (location: RawLocation, onComplete?: Function, onAbort?: Function) {

    // 从 location 解析 route 对象，调用自身 router 对象的 match 方法来解析
    const route = this.router.match(location, this.current)

    // 调用 confirmTransition
    this.confirmTransition(route, () => {
      this.updateRoute(route)
      onComplete && onComplete(route)
      this.ensureURL()

      // fire ready cbs once
      if (!this.ready) {
        this.ready = true
        this.readyCbs.forEach(cb => { cb(route) })
      }
    }, err => {
      if (onAbort) {
        onAbort(err)
      }
      if (err && !this.ready) {
        this.ready = true
        this.readyErrorCbs.forEach(cb => { cb(err) })
      }
    })
  }

  /**
   * [confirmTransition 确认跳转方法，会清空一些回调和触发导航守卫]
   * @param  {[type]} route      [路径对象]
   * @param  {[type]} onComplete [完成时回调]
   * @param  {[type]} onAbort    [取消时回调]
   * @return {[type]}            [description]
   */
  confirmTransition (route: Route, onComplete: Function, onAbort?: Function) {

    // 获取当前的 route 对象
    const current = this.current

    // 封装 onAbort，清空 errorsCbs
    const abort = err => {
      if (isError(err)) {
        if (this.errorCbs.length) {
          this.errorCbs.forEach(cb => { cb(err) })
        } else {
          warn(false, 'uncaught error during route navigation:')
          console.error(err)
        }
      }
      onAbort && onAbort(err)
    }

    // 如果要跳转的路径和当前路径相同，则触发 abort
    if (
      isSameRoute(route, current) &&
      // in the case the route map has been dynamically appended to
      route.matched.length === current.matched.length
    ) {
      this.ensureURL()
      return abort()
    }

    // 解析当前路径和要跳转路径的差异
    const {
      updated, // 将被更新的基路径
      deactivated, // 将要失活的路径
      activated // 将要激活的路径
    } = resolveQueue(this.current.matched, route.matched)

    // 根据路径差异构造出将被执行的函数队列
    // 定义了 route 跳转时的相关钩子执行的顺序
    const queue: Array<?NavigationGuard> = [].concat(
      // in-component leave guards
      // 提取出将要失活路径的 leave 的导航守卫
      extractLeaveGuards(deactivated),
      // global before hooks
      // 全局的 before 钩子
      this.router.beforeHooks,
      // in-component update hooks
      // updated 的基本路径的 updated 钩子
      extractUpdateHooks(updated),
      // in-config enter guards
      // 调用路由配置里的 beforeEnter
      activated.map(m => m.beforeEnter),
      // async components
      // 解析将要激活路径匹配的异步组件
      resolveAsyncComponents(activated)
    )

    this.pending = route

    /**
     * [iterator 队列遍历的执行函数]
     * @param  {[type]}   hook [description]
     * @param  {Function} next [description]
     * @return {[type]}        [description]
     */
    const iterator = (hook: NavigationGuard, next) => {
      if (this.pending !== route) {
        return abort()
      }
      try {
        /**
         * [hook 将要清空的队列中的函数，是钩子函数或导航守卫]
         * @param  {[type]} route   [将要跳转的路径对象]
         * @param  {[type]} current [当前的路径对象]
         * @param  {[type]} to      [next 钩子函数，to 为下一次跳转的参数]
         * @return {[type]}         []
         */
        hook(route, current, (to: any) => {
          if (to === false || isError(to)) {
            // next(false) -> abort navigation, ensure current URL
            this.ensureURL(true)
            abort(to)
          } else if (
            typeof to === 'string' ||
            (typeof to === 'object' && (
              typeof to.path === 'string' ||
              typeof to.name === 'string'
            ))
          ) {
            // next('/') or next({ path: '/' }) -> redirect
            abort()
            if (typeof to === 'object' && to.replace) {
              this.replace(to)
            } else {
              this.push(to)
            }
          } else {
            // confirm transition and pass on the value
            // 执行队列中下一个钩子函数
            // 如果跳转到 to 路径了，就不会再执行下一个钩子了
            next(to)
          }
        })
      } catch (e) {
        abort(e)
      }
    }

    // 用遍历器遍历刚才构造的函数队列，并添加队列遍历结束后的回调
    runQueue(queue, iterator, () => {
      const postEnterCbs = []
      const isValid = () => this.current === route
      // wait until async components are resolved before
      // extracting in-component enter guards
      // 抽取激活路径的 enter 导航守卫，并将相应回调放入 postEnterCbs 中，即传给 next 的回调参数
      const enterGuards = extractEnterGuards(activated, postEnterCbs, isValid)
      // 构造新的函数队列（ 每个激活组件的 enter 导航守卫 + resolveHooks 即全局的 beforeResolve ）
      const queue = enterGuards.concat(this.router.resolveHooks)
      // 清空队列
      runQueue(queue, iterator, () => {
        if (this.pending !== route) {
          return abort()
        }
        this.pending = null
        // ？调用全局 afterEach 钩子
        onComplete(route)
        // 下次 dom 更新循环之后执行，也就是说在这些回调中能获取到因本次 model 改变而响应后的 dom
        if (this.router.app) {
          this.router.app.$nextTick(() => {
            postEnterCbs.forEach(cb => { cb() })
          })
        }
      })
    })
  }

  /**
   * [updateRoute 更新路径对象并调用回调函数]
   * @param  {[type]} route [路径对象]
   * @return {[type]}       []
   */
  updateRoute (route: Route) {
    const prev = this.current
    this.current = route
    this.cb && this.cb(route)
    // 清空全局的 after 钩子的函数队列
    this.router.afterHooks.forEach(hook => {
      hook && hook(route, prev)
    })
  }
}

/**
 * [normalizeBase 格式化 base 路径，直截取路径，忽略协议和域名]
 * @param  {[type]} base [description]
 * @return {[type]}      [description]
 */
function normalizeBase (base: ?string): string {

  // 如果没有传入 base，尝试从 base 标签获取
  if (!base) {
    if (inBrowser) {
      // respect <base> tag
      const baseEl = document.querySelector('base')
      base = (baseEl && baseEl.getAttribute('href')) || '/'
      // strip full URL origin
      // 清掉协议和域名及端口
      base = base.replace(/^https?:\/\/[^\/]+/, '')
    } else {
      base = '/'
    }
  }
  // make sure there's the starting slash
  if (base.charAt(0) !== '/') {
    base = '/' + base
  }
  // remove trailing slash
  // 除去末尾的 /
  return base.replace(/\/$/, '')
}

/**
 * [resolveQueue 对比当前和将要跳转的 route 对象]
 * @param  {[type]}   current [当前路径对象]
 * @param  {Function} next    [将要跳转的路径对象]
 * @return {[type]}           []
 */
function resolveQueue (
  current: Array<RouteRecord>,
  next: Array<RouteRecord>
): {
  updated: Array<RouteRecord>,
  activated: Array<RouteRecord>,
  deactivated: Array<RouteRecord>
} {
  let i
  // 遍历两者的匹配数组，i 定位到第一个不匹配的位置
  const max = Math.max(current.length, next.length)
  for (i = 0; i < max; i++) {
    if (current[i] !== next[i]) {
      break
    }
  }
  return {
    updated: next.slice(0, i), // 将被更新的基础路径，在该基础上进行激活或失活
    activated: next.slice(i), // 将要激活的相对路径
    deactivated: current.slice(i) // 将要失活的路径
  }
}

/**
 * [extractGuards 根据 route 对象抽取相应的导航守卫]
 * @param  {[type]} records [RouteRecord 对象数组，实际上是 matched 数组]
 * @param  {[type]} name    [守卫名称]
 * @param  {[type]} bind    [绑定的方法]
 * @param  {[type]} reverse [排序反转]
 * @return {[type]}         []
 */
function extractGuards (
  records: Array<RouteRecord>,
  name: string,
  bind: Function,
  reverse?: boolean
): Array<?Function> {
  const guards = flatMapComponents(records,

    /**
     * [解析导航的]
     * @param  {[type]} def      [vue 的一堆钩子对象以及构造器]
     * @param  {[type]} instance [vue 实例]
     * @param  {[type]} match    [当前的 match，一个 RouteRecord 对象]
     * @param  {[type]} key      [components 对应的 key，默认是 default]
     * @return {[type]}          [description]
     */
    (def, instance, match, key) => {
      const guard = extractGuard(def, name) // 抽出一个单独的导航守卫
      if (guard) {
        return Array.isArray(guard)
          ? guard.map(guard => bind(guard, instance, match, key))
          : bind(guard, instance, match, key)
      }
    })
  return flatten(reverse ? guards.reverse() : guards)
}

/**
 * [extractGuard 抽取单个导航守卫]
 * @param  {[type]} def [包含了 vue 组件里定义的钩子]
 * @param  {[type]} key [组件名]
 * @return {[type]}     [description]
 */
function extractGuard (
  def: Object | Function,
  key: string
): NavigationGuard | Array<NavigationGuard> {
  if (typeof def !== 'function') {
    // extend now so that global mixins are applied.
    def = _Vue.extend(def)
  }
  return def.options[key]
}

function extractLeaveGuards (deactivated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(deactivated, 'beforeRouteLeave', bindGuard, true)
}

function extractUpdateHooks (updated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(updated, 'beforeRouteUpdate', bindGuard)
}

function bindGuard (guard: NavigationGuard, instance: ?_Vue): ?NavigationGuard {
  if (instance) {
    return function boundRouteGuard () {
      return guard.apply(instance, arguments)
    }
  }
}

function extractEnterGuards (
  activated: Array<RouteRecord>,
  cbs: Array<Function>,
  isValid: () => boolean
): Array<?Function> {
  return extractGuards(activated, 'beforeRouteEnter', (guard, _, match, key) => {
    return bindEnterGuard(guard, match, key, cbs, isValid)
  })
}

function bindEnterGuard (
  guard: NavigationGuard,
  match: RouteRecord,
  key: string,
  cbs: Array<Function>,
  isValid: () => boolean
): NavigationGuard {
  return function routeEnterGuard (to, from, next) {
    return guard(to, from, cb => {
      next(cb)
      if (typeof cb === 'function') {
        cbs.push(() => {
          // #750
          // if a router-view is wrapped with an out-in transition,
          // the instance may not have been registered at this time.
          // we will need to poll for registration until current route
          // is no longer valid.
          poll(cb, match.instances, key, isValid)
        })
      }
    })
  }
}

function poll (
  cb: any, // somehow flow cannot infer this is a function
  instances: Object,
  key: string,
  isValid: () => boolean
) {
  if (instances[key]) {
    cb(instances[key])
  } else if (isValid()) {
    setTimeout(() => {
      poll(cb, instances, key, isValid)
    }, 16)
  }
}
