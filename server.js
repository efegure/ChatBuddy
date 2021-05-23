const express = require('express');
const bodyParser = require('body-parser')
const urlencodedParser = bodyParser.urlencoded({ extended: true })
const fileUpload = require('express-fileupload');
const mongo = require('mongodb');

const MongoClient = mongo.MongoClient;
const cookieParser = require("cookie-parser");
var session = require('express-session');
var sharedsession = require("express-socket.io-session");

//mongo db
const dbName = "chatDb";
const secret ="YOUR_SECRET"
const key ="YOUR_KEY"
const url = "mongodb://localhost:27017/dbName";
MongoClient.connect(url, function (err, db) {
    if (err)
        console.log(err);
    console.log("Database Connected :)");
    db.close();
});

//moment
var moment = require('moment');
moment().format();

//express
const app = express();
app.use(express.json({ limit: '1mb' }))

const http = require('http').Server(app);

var server = app.listen(8080, function () {
    var host = server.address().address
    var port = server.address().port
    console.log("Example app listening at http://%s:%s", host, port)
});

const io = require('socket.io')(server);

const newSession = session({ secret:secret, resave: false, saveUninitialized: true })
app.use(newSession);

io.use(sharedsession(newSession, {
    autoSave: true
}));

//session
app.use(fileUpload({ createParentPath: true }));
app.use(cookieParser());
app.set('view engine', 'ejs');


//crypto
const crypto = require('crypto');
const iv = crypto.randomBytes(16);

//helpers
function encrypt(text) {
    let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return { iv: iv.toString('hex'), encryptedData: encrypted.toString('hex') };
}

function decrypt(text) {
    let iv = Buffer.from(text.iv, 'hex');
    let encryptedText = Buffer.from(text.encryptedData, 'hex');
    let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), iv);
    decipher.setAutoPadding(false);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

function decryptMessages(messages) {
    const decrypted = "[" + decrypt(messages).split('[').pop().split(']')[0] + "]";
    console.log("decrypted", decrypted);
    console.log("JSON", JSON.parse(decrypted));
    return decrypted;
}


//socket
io.on('connection', (socket) => {
    socket.on('enterRoom', function (newroom) {
        // join new room, received as function parameter
        socket.join(newroom);
        socket.emit('enteredRoom', 'you have connected to ' + newroom);
        // update socket session room title
        socket.room = newroom;
        // socket.broadcast.to(newroom).emit('updatechat', 'SERVER', socket.username+' has joined this room');
        // socket.emit('updaterooms', rooms, newroom);
    });

    socket.on('message', function (message) {
        // join new room, received as function parameter
        // update socket session room title
        console.log("message received", message, socket.room)
        MongoClient.connect(url, function (err, db) {
            var dbo = db.db(dbName);

            dbo.collection("chats").findOne({ '_id': new mongo.ObjectID(socket.room) }, function (err, chat) {
                if (err) throw err;
                const newMessage = { sender: socket.handshake.session.user, content: message, date: new Date() };
                const messages = chat.messages === null ? [] : JSON.parse(decryptMessages(chat.messages));
                const updatedMessages = [...messages, newMessage];
                const encryptedMessages = encrypt(JSON.stringify(updatedMessages));
                dbo.collection("chats").updateOne({ '_id': new mongo.ObjectID(socket.room) }, { $set: { messages: encryptedMessages } }, function (err, result) {
                    if (err) throw err;
                    console.log(result)
                    io.to(socket.room).emit('message', newMessage);
                });
                db.close();
            });
        })
    });
});

//http methods
app.get('/', function (req, res) {
    res.sendFile(__dirname + "/" + "login.html");
})

app.get('/signup', function (req, res) { res.sendFile(__dirname + "/" + "signUp.html"); })
app.get('/reset-password', function (req, res) { res.render('../reset-password'); })


app.get('/logout', function (req, res) {
    req.session.destroy();
    res.sendFile(__dirname + "/" + "login.html");
})





app.get('/profile', function (req, res) {
    if (req.session && req.session.user) {
        MongoClient.connect(url, function (err, db) {
            var dbo = db.db(dbName);
            dbo.collection("user").find({}).toArray(function (err, result) {
                if (err) throw err;
                var chatQuery = { participants: { $elemMatch: { $eq: req.session.user } } };
                dbo.collection("chats").find(chatQuery).toArray(function (err, chats) {
                    console.log(chats)
                    if (err) throw err;
                    db.close();
                    res.render('../profile', {
                        users: result.filter(user => user.username !== req.session.user),
                        chats: chats
                    });
                });
            });
        })
    }
    else {
        res.sendFile(__dirname + "/" + "login.html");
    }
})

app.post('/reset-password', function (req, res) {
    if (req.body.newpass === req.body.newpassrepeat) {
        MongoClient.connect(url, function (err1, db) {
            var dbo = db.db(dbName);
            var query = { username: req.body.username }
            dbo.collection("user").find(query).toArray(function (err, result) {
                if (err) throw err;
                if (result.length > 0 && req.body.password && req.body.password.replace(/\s+/g, "") === decrypt(result[0].password).replace(/\s+/g, "")) {
                    const encodedPW = encrypt(req.body.newpass);
                    dbo.collection("user").updateOne(query, { $set: { password: encodedPW } }, function (error, result) {
                        if (error) throw error;
                        console.log("1 document updated");
                        db.close();
                        res.sendFile(__dirname + "/" + "login.html")
                    });
                }
                else {
                    db.close();
                    res.render('../reset-password');
                }
            });
        })
    } else {
        //re-render profile page with error
        res.render('../reset-password', { displayError: true });
    }
})


app.post('/signup', urlencodedParser, function (req, res) {
    const encodedPW = encrypt(req.body.password);

    const user = { name: req.body.name, username: req.body.username, password: encodedPW, joinDate: new Date() };
    // req.files.photo.mv(__dirname + "/upload/" + req.files.photo.name);

    MongoClient.connect(url, function (err, db) {
        if (err) {
            console.log(err);
            res.end("Error In Registration !!!");
        }
        var dbo = db.db(dbName);
        dbo.collection("user").insertOne(user, function (err, result) {
            if (err) throw err;
            console.log("1 document inserted");
            db.close();
            res.sendFile(__dirname + "/" + "login.html");
        });
    });
})

app.get('/login', function (req, res) {
    if (req.session && req.session.user) {
        MongoClient.connect(url, function (err, db) {
            if (err) throw err;
            var dbo = db.db(dbName);


            dbo.collection("user").find({}).toArray(function (err, result) {
                if (err) throw err;
                var chatQuery = { participants: { $elemMatch: { $eq: req.session.user } } };
                dbo.collection("chats").find(chatQuery).toArray(function (err, chats) {
                    console.log(chats)
                    if (err) throw err;
                    if (err) throw err;
                    if (chats && chats.length > 0) {
                        chats.forEach(chat => {

                            const chatMessages = chat.messages === null ? null : JSON.parse(decryptMessages(chat.messages));
                            chat.lastMessage = chatMessages === null ? "" : chatMessages[chatMessages.length - 1].content;
                            chat.lastMessageTime =  chatMessages === null ?  moment(chat.date).fromNow() : moment(chatMessages[chatMessages.length - 1].date).fromNow()
                        })
                        console.log("chats is ", chats)

                        res.render('../profile', {
                            users: result.filter(user => user.username !== req.session.user),
                            chats,
                            user: req.session.user
                        });
                        db.close();

                    } else {
                        res.render('../profile', {
                            users: result.filter(user => user.username !== req.session.user),
                            chats: [],
                            user: req.session.user
                        });
                        db.close();

                    }

                });

            });
        });
    }
    else {
        res.sendFile(__dirname + "/" + "login.html");
    }
})

app.post('/login', urlencodedParser, function (req, res) {
    MongoClient.connect(url, function (err, db) {
        if (err) throw err;
        var dbo = db.db(dbName);
        var query = { username: req.body.username }
        dbo.collection("user").find(query).toArray(function (err, result) {
            if (err) throw err;
            if (result.length > 0 && req.body.password.replace(/\s+/g, "") === decrypt(result[0].password).replace(/\s+/g, "")) {
                req.session.user = result[0].username;

                dbo.collection("user").find({}).toArray(function (err, userList) {
                    if (err) throw err;
                    var chatQuery = { participants: { $elemMatch: { $eq: req.session.user } } };
                    dbo.collection("chats").find(chatQuery).toArray(function (err, chats) {
                        console.log(chats)
                        if (err) throw err;
                        if (err) throw err;
                        if (chats && chats.length > 0) {
                            chats.forEach(chat => {

                                const chatMessages = chat.messages === null ? null : JSON.parse(decryptMessages(chat.messages));
                                chat.lastMessage = chatMessages === null ? "" : chatMessages[chatMessages.length - 1].content;
                                chat.lastMessageTime =  chatMessages === null ?  moment(chat.date).fromNow() : moment(chatMessages[chatMessages.length - 1].date).fromNow()
                            })
                            console.log("chats is ", chats,userList)

                            res.render('../profile', {
                                users: userList.filter(user => user.username !== req.session.user),
                                chats,
                                user: req.session.user
                            });
                            db.close();

                        } else {
                            res.render('../profile', {
                                users: userList.filter(user => user.username !== req.session.user),
                                chats: [],
                                user: req.session.user
                            });
                            db.close();

                        }

                    });

                });
            }
            else {
                res.sendFile(__dirname + "/" + "login.html");
                db.close();
            }
        });
    });
})


app.post('/create-chat', urlencodedParser, function (req, res) {
    if (req.session && req.session.user) {
        res.setHeader('Content-Type', 'application/json');
        MongoClient.connect(url, function (err, db) {
            if (err) throw err;
            var dbo = db.db(dbName);
            var query = { $and: [{ participants: { $elemMatch: { $eq: req.session.user } } }, { participants: { $elemMatch: { $eq: req.body.participants[0] } } }] };
            var chat = { participants: [...req.body.participants, req.session.user], date: new Date(), messages: null };
            // check if the chat already exists
            dbo.collection("chats").find(query).toArray(function (err, result) {
                console.log("chat exists!", result);
                if (err) throw err;
                if (result.length > 0) {
                    console.log("chat count is!", result.length);
                    const jsn = { id: result[0]._id };

                    res.end(JSON.stringify(jsn));
                    db.close();

                }
                else {
                    dbo.collection("chats").insertOne(chat, function (err, newChat) {
                        if (err) throw err;
                        console.log("1 document inserted", newChat);
                        res.end(JSON.stringify({id:newChat.insertedId}));
                        db.close();
                    });
                }
            });
        });
    }
})

app.get('/chat', function (req, res) {
    if (req.session && req.session.user) {
        if (req.query.id) {
            MongoClient.connect(url, function (err, db) {
                var dbo = db.db(dbName);

                dbo.collection("chats").findOne({ '_id': new mongo.ObjectID(req.query.id) }, function (err, result) {
                    if (err) throw err;
                    console.log("chat found!", result.messages === null)
                    let messages = []
                    if (result.messages !== null) {
                        messages = JSON.parse(decryptMessages(result.messages));
                    }
                    res.render('../chat', {
                        messages,
                        user: req.session.user,
                        participants: result.participants.filter(user=>user !== req.session.user)
                    });
                    db.close();
                });
            })
        }
    }
    else {
        res.sendFile(__dirname + "/" + "login.html");
    }
})



