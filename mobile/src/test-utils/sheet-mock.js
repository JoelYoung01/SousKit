const React = require("react");

function Sheet({ visible, children, footer }) {
  if (!visible) return null;
  return React.createElement(React.Fragment, null, children, footer);
}

module.exports = { Sheet };
