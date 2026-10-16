const mode = process.argv[2];
if (mode === 'hang') setInterval(() => {}, 1000);
else if (mode === 'flood') setInterval(() => process.stdout.write('x'.repeat(8192)), 1);
else if (mode === 'error') { process.stderr.write('fixture error'); process.exitCode = 2; }
else { let text = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (chunk) => { text += chunk; }); process.stdin.on('end', () => process.stdout.write(text)); }
