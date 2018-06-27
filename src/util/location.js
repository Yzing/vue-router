/* @flow */

import type VueRouter from '../index'
import { parsePath, resolvePath } from './path'
import { resolveQuery } from './query'
import { fillParams } from './params'
import { warn } from './warn'

/**
 * [normalizeLocation 格式化 location]
 * @param  {[String, Location]} raw [原始路径，string 或 Location 对象]
 * @param  {[type]} current [当前的路由对象]
 * @param  {[type]} append  [description]
 * @param  {[type]} router  [description]
 * @return {[type]}         [description]
 */
export function normalizeLocation (
  raw: RawLocation,
  current: ?Route,
  append: ?boolean,
  router: ?VueRouter
): Location {
  let next: Location = typeof raw === 'string' ? { path: raw } : raw

  // named target
  // 如果已经格式化过或者用 name 作为跳转参数，就不在本函数中做任何处理
  if (next.name || next._normalized) {
    return next
  }

  // relative params
  // 不跳转路由而是直接在当前路由拼接参数
  if (!next.path && next.params && current) {
    next = assign({}, next)
    next._normalized = true
    const params: any = assign(assign({}, current.params), next.params)
    if (current.name) {
      next.name = current.name
      next.params = params
    } else if (current.matched.length) {

      // 获取当前路由最后命中的路径
      const rawPath = current.matched[current.matched.length - 1].path

      // 将参数拼接在路径上
      next.path = fillParams(rawPath, params, `path ${current.path}`)
    } else if (process.env.NODE_ENV !== 'production') {
      warn(false, `relative params navigation requires a current route.`)
    }
    return next
  }

  // 可以用相对路径的写法，就像 unix 目录一样
  const parsedPath = parsePath(next.path || '')

  // 当前路由路径会当作基本参照
  const basePath = (current && current.path) || '/'

  const path = parsedPath.path
    ? resolvePath(parsedPath.path, basePath, append || next.append)
    : basePath

  // 获取 query 参数
  // 用户可以自定义参数解析规则
  const query = resolveQuery(
    parsedPath.query,
    next.query,
    router && router.options.parseQuery
  )

  let hash = next.hash || parsedPath.hash
  if (hash && hash.charAt(0) !== '#') {
    hash = `#${hash}`
  }

  return {
    _normalized: true,
    path,
    query,
    hash
  }
}

function assign (a, b) {
  for (const key in b) {
    a[key] = b[key]
  }
  return a
}
