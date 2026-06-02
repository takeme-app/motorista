/**
 * Gradle precisa de JAVA_HOME. Se não estiver definido, tenta o JBR do Android Studio.
 * (Windows: mesma lógica histórica; macOS/Linux: caminhos comuns da instalação.)
 */
const path = require('path');
const fs = require('fs');

function javaBinName() {
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

function isValidJavaHome(home) {
  return Boolean(home && fs.existsSync(path.join(home, 'bin', javaBinName())));
}

function candidateJavaHomes() {
  if (process.platform === 'win32') {
    return [
      'C:\\Program Files\\Android\\Android Studio\\jbr',
      'C:\\Program Files\\Android\\Android Studio\\jre',
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Android Studio', 'jbr'),
    ].filter(Boolean);
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
      '/Applications/Android Studio.app/Contents/jbr',
      '/Applications/Android Studio.app/Contents/jre/Contents/Home',
    ];
  }
  return [
    '/opt/android-studio/jbr',
    process.env.HOME && path.join(process.env.HOME, 'android-studio', 'jbr'),
  ].filter(Boolean);
}

/**
 * Só altera o ambiente se JAVA_HOME estiver vazio; encontra JDK em instalação típica do Android Studio.
 * @returns {boolean} true se JAVA_HOME ficou definido (já era ou foi encontrado)
 */
function trySetJavaHomeFromAndroidStudio() {
  if (process.env.JAVA_HOME) return true;
  for (const p of candidateJavaHomes()) {
    if (isValidJavaHome(p)) {
      process.env.JAVA_HOME = p;
      return true;
    }
  }
  return false;
}

module.exports = {
  trySetJavaHomeFromAndroidStudio,
  candidateJavaHomes,
  isValidJavaHome,
};
