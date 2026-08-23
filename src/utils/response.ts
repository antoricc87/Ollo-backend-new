export class Util {
  static success(payload: any, message: string) {
    return { success: true, message: message, result: payload };
  }

  static error(payload = {}, message: string) {
    return { success: false, message: message, result: payload };
  }
}

export default Util;
