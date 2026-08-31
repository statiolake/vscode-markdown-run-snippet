import * as fs from "fs";
import * as Mocha from "mocha";
import * as path from "path";

export function run(): Promise<void> {
  const mocha = new Mocha({
    color: true,
    ui: "tdd",
  });
  const testsRoot = path.resolve(__dirname);

  return new Promise((resolve, reject) => {
    fs.readdir(testsRoot, (error, files) => {
      if (error) {
        reject(error);
        return;
      }

      files
        .filter((file) => file.endsWith(".test.js"))
        .forEach((file) => mocha.addFile(path.resolve(testsRoot, file)));

      try {
        mocha.run((failures) => {
          if (failures > 0) {
            reject(new Error(`${failures} test(s) failed.`));
          } else {
            resolve();
          }
        });
      } catch (runError) {
        reject(runError);
      }
    });
  });
}
