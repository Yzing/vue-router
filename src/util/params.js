/* @flow */

import { warn } from './warn'
import Regexp from 'path-to-regexp'

// $flow-disable-line
const regexpCompileCache: {
  [key: string]: Function
} = Object.create(null)

/**
 * [fillParams 将 param 拼接到路径上]
 * @param  {[type]} path     []
 * @param  {[type]} params   []
 * @param  {[type]} routeMsg []
 * @return {[type]}          []
 */
export function fillParams (
  path: string,
  params: ?Object,
  routeMsg: string
): string {
  try {
    // 将字符串编译为 path-to-regexp 对象，并缓存
    const filler =
      regexpCompileCache[path] ||
      (regexpCompileCache[path] = Regexp.compile(path))
    return filler(params || {}, { pretty: true })
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      warn(false, `missing param for ${routeMsg}: ${e.message}`)
    }
    return ''
  }
}
