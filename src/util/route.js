/* @flow */

import type VueRouter from '../index'
import { stringifyQuery } from './query'

const trailingSlashRE = /\/?$/

/**
 * [route 对象工厂] 实际上对 当前的 location 和 routeRecord 进行了封装
 * @param  {[type]} record         [RouteRecord 对象，在执行 match 方法时创建]
 * @param  {[type]} location       [当前的路由的 location]
 * @param  {[type]} redirectedFrom [重定向来源]
 * @param  {[type]} router         [router 对象]
 * @return {[type]}                [Route 对象]
 */
export function createRoute (
  record: ?RouteRecord,
  location: Location,
  redirectedFrom?: ?Location,
  router?: VueRouter
): Route {

  // 字符串化 query 的方法
  const stringifyQuery = router && router.options.stringifyQuery

  // 从当前 location 中获取 query 对象，对自己进行一次深度克隆
  let query: any = location.query || {}
  try {
    query = clone(query)
  } catch (e) {}

  const route: Route = {
    name: location.name || (record && record.name),
    meta: (record && record.meta) || {},
    path: location.path || '/',
    hash: location.hash || '',
    query,
    params: location.params || {},
    fullPath: getFullPath(location, stringifyQuery),
    matched: record ? formatMatch(record) : []
  }
  if (redirectedFrom) {
    route.redirectedFrom = getFullPath(redirectedFrom, stringifyQuery)
  }

  // 只读
  return Object.freeze(route)
}

// 深度克隆
function clone (value) {
  if (Array.isArray(value)) {
    return value.map(clone)
  } else if (value && typeof value === 'object') {
    const res = {}
    for (const key in value) {
      res[key] = clone(value[key])
    }
    return res
  } else {
    return value
  }
}

// the starting route that represents the initial state
// 初始化 route 对象
export const START = createRoute(null, {
  path: '/'
})

// 格式化 matched 数组，即扁平化 routeRecord
function formatMatch (record: ?RouteRecord): Array<RouteRecord> {
  const res = []
  while (record) {
    res.unshift(record)
    record = record.parent
  }
  return res
}

function getFullPath (
  { path, query = {}, hash = '' },
  _stringifyQuery
): string {
  const stringify = _stringifyQuery || stringifyQuery
  return (path || '/') + stringify(query) + hash
}

/**
 * [isSameRoute 判断两个 route 对象是否相等]
 * @param  {[type]}  a [description]
 * @param  {[type]}  b [description]
 * @return {Boolean}   [description]
 */
export function isSameRoute (a: Route, b: ?Route): boolean {
  // 由于 START 是单例，直接比较引用即可
  if (b === START) {
    return a === b
  } else if (!b) {
    return false
  } else if (a.path && b.path) {
    // 如果都有 path 属性，比较 path、hash、query
    return (
      a.path.replace(trailingSlashRE, '') === b.path.replace(trailingSlashRE, '') &&
      a.hash === b.hash &&
      isObjectEqual(a.query, b.query)
    )
  } else if (a.name && b.name) {
    // 如果有 name 属性，比较 name、hash、query、params
    return (
      a.name === b.name &&
      a.hash === b.hash &&
      isObjectEqual(a.query, b.query) &&
      isObjectEqual(a.params, b.params)
    )
  } else {
    return false
  }
}

/**
 * [isObjectEqual 比较两个对象是否相等，采用值比较而非引用比较]
 * @param  {Object}  [a={}] [description]
 * @param  {Object}  [b={}] [description]
 * @return {Boolean}        [description]
 */
function isObjectEqual (a = {}, b = {}): boolean {
  // handle null value #1566
  if (!a || !b) return a === b

  // 取键值遍历
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  // 如果键的个数不一样，肯定不相等
  if (aKeys.length !== bKeys.length) {
    return false
  }
  // 键个数一样，如果值类型为 object，继续递归比较，否则将值转化为 String 进行比较
  return aKeys.every(key => {
    const aVal = a[key]
    const bVal = b[key]
    // check nested equality
    if (typeof aVal === 'object' && typeof bVal === 'object') {
      return isObjectEqual(aVal, bVal)
    }
    return String(aVal) === String(bVal)
  })
}

/**
 * [isIncludedRoute 判断 current 是否包含 target]
 * @param  {[type]}  current [当前 route]
 * @param  {[type]}  target  [要比较的 route]
 * @return {Boolean}         [description]
 */
export function isIncludedRoute (current: Route, target: Route): boolean {
  // 首先保证前缀相等，然后 target 的 hash 没有或者和 current 的相等，并且 qurey 要有包含关系
  return (
    current.path.replace(trailingSlashRE, '/').indexOf(
      target.path.replace(trailingSlashRE, '/')
    ) === 0 &&
    (!target.hash || current.hash === target.hash) &&
    queryIncludes(current.query, target.query)
  )
}

function queryIncludes (current: Dictionary<string>, target: Dictionary<string>): boolean {
  for (const key in target) {
    if (!(key in current)) {
      return false
    }
  }
  return true
}
