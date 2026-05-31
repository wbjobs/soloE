#include "mainwindow.h"
#include <QApplication>
#include <QTextCodec>

int main(int argc, char *argv[])
{
    QApplication a(argc, argv);

    QTextCodec *codec = QTextCodec::codecForName("UTF-8");
    if (codec) {
        QTextCodec::setCodecForLocale(codec);
    }

    QApplication::setApplicationName("Markdown 编辑器");
    QApplication::setApplicationVersion("1.0");

    MainWindow w;
    w.show();

    return a.exec();
}
