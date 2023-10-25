import * as core from '@actions/core'
import {Logger} from '../core/provider/Logger'

export class GHALogger implements Logger {
  info(message: string): void {
    console.log(message)
  }
  debug(message: string): void {
    core.debug(message)
  }
}
