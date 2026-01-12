require('dotenv').config();

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const envVars = {
    E2P_CLIENT_ID: process.env.E2P_CLIENT_ID ? '✓ Presente' : '✗ Faltando',
    E2P_CLIENT_SECRET: process.env.E2P_CLIENT_SECRET ? '✓ Presente' : '✗ Faltando',
    E2P_MPESA_WALLET: process.env.E2P_MPESA_WALLET ? '✓ Presente' : '✗ Faltando',
    E2P_EMOLA_WALLET: process.env.E2P_EMOLA_WALLET ? '✓ Presente' : '✗ Faltando',
    UTMIFY_TOKEN: process.env.UTMIFY_TOKEN ? '✓ Presente' : '✗ Faltando'
  };

  const allPresent = Object.values(envVars).every(v => v.includes('✓'));

  res.status(200).json({
    success: allPresent,
    message: allPresent ? 'Todas as variáveis estão configuradas' : 'Faltam variáveis de ambiente',
    variables: envVars,
    timestamp: new Date().toISOString(),
    nodeVersion: process.version
  });
};
