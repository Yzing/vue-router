/* @flow */

/**
 * [runQueue 清空队列后执行回调]
 * @param  {[type]}   queue [导航守卫]
 * @param  {Function} fn    []
 * @param  {Function} cb    [description]
 * @return {[type]}         [description]
 */
export function runQueue (queue: Array<?NavigationGuard>, fn: Function, cb: Function) {

  // 步进器
  /**
   * [step description]
   * @param  {[type]} index [当前步进的下标]
   * @return {[type]}       [description]
   */
  const step = index => {
    // 如果当前下标超出，说明 queue 遍历完成，直接调用回调即可
    if (index >= queue.length) {
      cb()
    } else {
      // 如果当前步进的下标在队列中有值，就用 fn 执行，并将下一次步进作为回调
      if (queue[index]) {
        fn(queue[index], () => {
          step(index + 1)
        })
      } else {
        // 否则直接调用下次步进
        step(index + 1)
      }
    }
  }
  step(0)
}
