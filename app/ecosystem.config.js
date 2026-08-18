module.exports = {
  apps: [{
    name:        'catalogo_produtos',
    script:      'server.js',
    cwd:         '/var/www/catalogo_produtos/app',
    interpreter: 'none',
    env:         { NODE_ENV: 'production' },
    error_file:  '/var/log/catalogo-produtos-error.log',
    out_file:    '/var/log/catalogo-produtos-out.log',
    time:        true,
  }]
};
