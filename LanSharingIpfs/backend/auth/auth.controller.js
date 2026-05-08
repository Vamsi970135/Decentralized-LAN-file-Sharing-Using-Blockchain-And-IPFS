const db = require('../database.js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.register = (req, res) => {

    const { username, email, password } = req.body;

    const hash = bcrypt.hashSync(password, 8);

    db.run(
        "INSERT INTO users(username,email,password) VALUES(?,?,?)",
        [username, email, hash],
        function (err) {
            if (err) {
                return res.status(400).json({ message: "Email already registered" });
            }
            res.json({ message: "Registration successful" });
        }
    );
};

exports.login = (req, res) => {

    const { email, password } = req.body;

    db.get("SELECT * FROM users WHERE email=?", [email], (err, user) => {

        if (!user) return res.status(404).json({ message: "User not found" });

        const valid = bcrypt.compareSync(password, user.password);

        if (!valid) return res.status(401).json({ message: "Wrong password" });

        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.json({ token });
    });
};
