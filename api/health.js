module.exports = function(req, res) {
  const keys = Object.keys(process.env).filter(k => 
    k.includes("SUPABASE") || 
    k.includes("PROD") || 
    k.includes("VERCEL") ||
    k.includes("KEY") ||
    k.includes("SECRET")
  );
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({ present_env_keys: keys });
};
