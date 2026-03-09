const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('Installing dependencies...');

try {
    const npmPath = process.env.npm_execpath || 'npm';
    console.log('Using npm:', npmPath);
    
    execSync(`${npmPath} install`, {
        cwd: path.join(__dirname),
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/' }
    });
    
    console.log('Dependencies installed successfully!');
} catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
}
